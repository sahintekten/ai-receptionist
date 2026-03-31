import { Router } from "express";
import { verifyWebhookSignature } from "../middleware/auth";
import { resolveBusiness, resolveBusinessByPhone } from "../resolver/businessResolver";
import { createRequestContext } from "../lib/requestContext";
import {
  RetellFunctionCallSchema,
  CheckAvailabilityArgsSchema,
  CreateBookingArgsSchema,
  CancelBookingArgsSchema,
  LookupBookingsArgsSchema,
  TakeMessageArgsSchema,
  GetCallerMemoryArgsSchema,
  type FunctionName,
} from "../lib/validation";
import { logger } from "../lib/logger";
import { AppError, BusinessNotFoundError, IntegrationError, LookupRequiredError } from "../lib/errors";
import * as bookingService from "../services/booking";
import * as crmService from "../services/crm";
import * as memoryService from "../services/memory";
import type { ResolvedBusinessConfig } from "../types";
import type { RequestContext } from "../lib/requestContext";

const router = Router();

// ─── In-memory call phone cache (callId → phone, for post-call pipeline) ────

export const callPhoneCache = new Map<string, string>();

function cacheCallerPhone(callId: string, phone: string): void {
  if (phone && phone !== "unknown") {
    callPhoneCache.set(callId, phone);
  }
}

// ─── In-memory lookup tracking (safety net for cancel/reschedule) ────

const lookupTracker = new Map<string, boolean>();

function recordLookup(callId: string): void {
  lookupTracker.set(callId, true);
}

function hasLookup(callId: string): boolean {
  return lookupTracker.get(callId) === true;
}

// Clean up old entries periodically (prevent memory leak)
setInterval(() => {
  if (lookupTracker.size > 10_000) lookupTracker.clear();
  if (callPhoneCache.size > 10_000) callPhoneCache.clear();
}, 60 * 60 * 1000);

// ─── Date Formatting ────────────────────────────────────

function formatDateTurkish(isoDate: string, timezone: string): string {
  const date = new Date(isoDate);
  const dayMonth = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", weekday: "long", timeZone: timezone,
  }).format(date);
  const time = new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit", minute: "2-digit", timeZone: timezone,
  }).format(date);
  return `${dayMonth} saat ${time}`;
}

// ─── Phone Normalization ─────────────────────────────────

function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-()]/g, "");
  // Turkish: leading 0 → +90
  if (p.startsWith("0") && p.length === 11) {
    p = "+90" + p.substring(1);
  }
  // Add +90 if 10 digits starting with 5
  if (/^\d{10}$/.test(p) && p.startsWith("5")) {
    p = "+90" + p;
  }
  return p;
}

// ─── Function Handlers ───────────────────────────────────

type HandlerResult = Record<string, unknown>;
type FunctionHandler = (
  args: Record<string, unknown>,
  config: ResolvedBusinessConfig,
  ctx: RequestContext
) => Promise<HandlerResult>;

async function handleCheckAvailability(
  args: Record<string, unknown>,
  config: ResolvedBusinessConfig,
  ctx: RequestContext
): Promise<HandlerResult> {
  const parsed = CheckAvailabilityArgsSchema.parse(args);

  // Normalize: accept both camelCase and snake_case
  const dateRange = parsed.dateRange || parsed.date_range || parsed.preferred_date;
  const serviceType = parsed.serviceType || parsed.service_type;
  const doctorName = parsed.doctor_name;

  // Default: next 3 days from now
  const now = new Date();
  const defaultEnd = new Date(now);
  defaultEnd.setDate(defaultEnd.getDate() + 3);

  let startDate = now.toISOString();
  let endDate = defaultEnd.toISOString();

  if (dateRange) {
    startDate = new Date(dateRange).toISOString();
    const rangeEnd = new Date(dateRange);
    rangeEnd.setDate(rangeEnd.getDate() + 1);
    endDate = rangeEnd.toISOString();
  }

  const result = await bookingService.checkAvailabilityForBusiness(
    ctx.businessId,
    config,
    { start: startDate, end: endDate },
    serviceType,
    ctx,
    doctorName
  );

  // Flatten slots into a simple array for the agent
  const allSlots: Array<{ date: string; start: string; end: string }> = [];
  for (const [date, daySlots] of Object.entries(result.slots)) {
    for (const slot of daySlots) {
      allSlots.push({ date, start: slot.start, end: slot.end });
    }
  }

  if (allSlots.length === 0) {
    return {
      result: "no_availability",
      user_message: "Maalesef bu tarihte müsait randevu slotu bulunmuyor efendim. Başka bir tarih denemek ister misiniz?",
      eventTypeId: result.eventTypeId,
      eventTypeName: result.eventTypeName,
    };
  }

  return {
    result: "success",
    slots: allSlots,
    eventTypeId: result.eventTypeId,
    eventTypeName: result.eventTypeName,
    total_slots: allSlots.length,
  };
}

async function handleCreateBooking(
  args: Record<string, unknown>,
  config: ResolvedBusinessConfig,
  ctx: RequestContext
): Promise<HandlerResult> {
  const parsed = CreateBookingArgsSchema.parse(args);

  // Normalize args: camelCase / snake_case / Retell format
  // Reject unresolved Retell template variables (e.g. "{{user_number}}")
  const isUnresolved = (v: unknown): boolean =>
    typeof v === "string" && /^\{\{.+\}\}$/.test(v.trim());

  const rawPhone = parsed.callerPhone || parsed.caller_phone || ctx.callerPhone;
  const phone = isUnresolved(rawPhone) ? "unknown" : rawPhone;
  const rawName = parsed.callerName || parsed.caller_name;
  const callerName = isUnresolved(rawName) ? "Arayan" : (rawName || "Arayan");

  // Slot: direct slot string, or build from date + time
  let slot = parsed.slot;
  if (!slot && parsed.date) {
    const time = parsed.time || "09:00";
    // Build ISO datetime — Cal.com expects the format from availability response
    // Availability returns: "2026-04-01T14:30:00.000+03:00"
    slot = `${parsed.date}T${time}:00.000+03:00`;
  }

  if (!slot) {
    return {
      result: "error",
      user_message: "Randevu tarihi belirtilmedi efendim. Hangi tarih ve saati tercih edersiniz?",
    };
  }

  // Event type: direct ID or resolve via doctorName > service_type
  const doctorName = parsed.doctor_name;
  const serviceType = parsed.service_type;
  let eventTypeId: number | undefined;

  if (parsed.eventTypeId) {
    eventTypeId = typeof parsed.eventTypeId === "string"
      ? parseInt(parsed.eventTypeId, 10)
      : parsed.eventTypeId;
  } else {
    const calcomIntegration = config.integrations.find((i) => i.type === "calcom");
    if (calcomIntegration) {
      const calcomConfig = calcomIntegration.config as { event_types?: Array<{ id: number; name: string; service_type: string; doctor_name?: string }> };

      // 1. Doctor name match (highest priority)
      if (doctorName) {
        const search = doctorName.toLowerCase();
        const match = calcomConfig.event_types?.find(
          (et) => et.doctor_name?.toLowerCase().includes(search)
        );
        if (match) eventTypeId = match.id;
      }

      // 2. Service type match
      if (!eventTypeId && serviceType) {
        const search = serviceType.toLowerCase();
        let match = calcomConfig.event_types?.find(
          (et) => et.service_type.toLowerCase() === search
        );
        if (!match) {
          match = calcomConfig.event_types?.find(
            (et) => et.service_type.toLowerCase().includes(search)
              || et.name.toLowerCase().includes(search)
          );
        }
        if (match) eventTypeId = match.id;
      }

      // 3. Single event type and no search terms → default
      if (!eventTypeId && !doctorName && !serviceType && calcomConfig.event_types?.length === 1) {
        eventTypeId = calcomConfig.event_types[0].id;
      }
    }
  }

  if (!eventTypeId) {
    return {
      result: "error",
      user_message: "Hangi işlem için randevu almak istiyorsunuz? Obezite veya estetik cerrahi seçeneklerimiz mevcut.",
    };
  }

  // Normalize Turkish phone: remove spaces, leading 0 → +90
  const normalizedPhone = normalizePhone(phone);

  logger.info("create_booking args resolved", {
    call_id: ctx.callId,
    business_id: ctx.businessId,
    action: "create_booking",
    status: "args_resolved",
    slot,
    event_type_id: eventTypeId,
    caller_phone: normalizedPhone,
    caller_name: callerName,
  });

  try {
    const requestedService = serviceType || doctorName;
    const result = await bookingService.createBookingForBusiness(
      ctx.businessId,
      config,
      normalizedPhone,
      slot,
      eventTypeId,
      callerName,
      ctx,
      requestedService
    );

    // Update memory — never block the call
    try {
      await memoryService.updateMemoryAfterCall(
        ctx.businessId, normalizedPhone,
        { recentAppointmentStatus: "booked", callerName },
        ctx
      );
    } catch (e) {
      logger.error("Memory update failed after booking", {
        call_id: ctx.callId, business_id: ctx.businessId, action: "create_booking_memory",
        status: "error", error: e instanceof Error ? e.message : String(e),
      });
    }

    return {
      result: "success",
      bookingUid: result.bookingUid,
      title: result.title,
      start: result.start,
      end: result.end,
      user_message: `Randevunuz oluşturuldu efendim. ${formatDateTurkish(result.start, config.business.timezone)} tarihinde sizi bekliyoruz.`,
    };
  } catch (error) {
    if (error instanceof IntegrationError) {
      const httpStatus = error.context?.httpStatus as number | undefined;
      const errorMsg = (error.context?.responseBody as string || error.message || "").toLowerCase();
      const isConflict = httpStatus === 409
        || (httpStatus === 400 && (errorMsg.includes("already has booking") || errorMsg.includes("not available")));

      if (isConflict) {
        logger.warn("Booking conflict, re-querying availability", {
          call_id: ctx.callId,
          business_id: ctx.businessId,
          action: "create_booking",
          status: "conflict",
          http_status: httpStatus,
        });

        return {
          result: "conflict",
          user_message: "Bu randevu slotu az önce doldu efendim. Müsait başka slotlara bakayım hemen.",
        };
      }
    }
    throw error;
  }
}

async function handleCancelBooking(
  args: Record<string, unknown>,
  config: ResolvedBusinessConfig,
  ctx: RequestContext
): Promise<HandlerResult> {
  if (!hasLookup(ctx.callId)) {
    throw new LookupRequiredError("cancel_booking");
  }

  const parsed = CancelBookingArgsSchema.parse(args);
  const bookingId = parsed.bookingId || parsed.booking_id;
  const phone = normalizePhone(parsed.callerPhone || parsed.caller_phone || ctx.callerPhone);

  if (!bookingId) {
    return {
      result: "error",
      user_message: "İptal edilecek randevu belirtilmedi efendim. Önce randevularınızı kontrol edeyim.",
    };
  }

  const result = await bookingService.cancelBookingForBusiness(
    ctx.businessId,
    config,
    bookingId,
    phone,
    ctx
  );

  // Update memory — never block the call
  try {
    await memoryService.updateMemoryAfterCall(
      ctx.businessId, phone,
      { recentAppointmentStatus: "cancelled" },
      ctx
    );
  } catch (e) {
    logger.error("Memory update failed after cancel", {
      call_id: ctx.callId, business_id: ctx.businessId, action: "cancel_booking_memory",
      status: "error", error: e instanceof Error ? e.message : String(e),
    });
  }

  return {
    result: "success",
    bookingUid: result.bookingUid,
    user_message: "Randevunuz iptal edildi efendim.",
  };
}

async function handleLookupBookings(
  args: Record<string, unknown>,
  config: ResolvedBusinessConfig,
  ctx: RequestContext
): Promise<HandlerResult> {
  const parsed = LookupBookingsArgsSchema.parse(args);
  recordLookup(ctx.callId);

  const phone = normalizePhone(parsed.callerPhone || parsed.caller_phone || ctx.callerPhone);
  const name = parsed.name || parsed.caller_name;
  const dateHint = parsed.dateHint || parsed.date_hint;

  const result = await bookingService.lookupBookingsForBusiness(
    ctx.businessId,
    config,
    phone,
    name,
    dateHint,
    ctx
  );

  if (result.bookings.length === 0) {
    return {
      result: "no_bookings",
      user_message: "Kayıtlı randevunuz bulunmuyor efendim.",
      bookings: [],
    };
  }

  return {
    result: "success",
    bookings: result.bookings,
    total: result.bookings.length,
  };
}

async function handleTakeMessage(
  args: Record<string, unknown>,
  config: ResolvedBusinessConfig,
  ctx: RequestContext
): Promise<HandlerResult> {
  const parsed = TakeMessageArgsSchema.parse(args);

  // Normalize: accept both camelCase and snake_case
  const phone = normalizePhone(parsed.callerPhone || parsed.caller_phone || ctx.callerPhone);
  const callerName = parsed.callerName || parsed.caller_name;
  const messageText = parsed.messageText || parsed.message || "";
  const messageTypeRaw = parsed.message_type || parsed.type;
  const messageType = (["message", "callback", "urgent"].includes(messageTypeRaw) ? messageTypeRaw : "message") as "message" | "callback" | "urgent";

  const typeLabels: Record<string, string> = {
    message: "MESAJ",
    callback: "GERI ARAMA",
    urgent: "ACIL",
  };

  try {
    // Upsert contact in CRM
    const { personId } = await crmService.upsertContactForBusiness(
      ctx.businessId,
      config,
      phone,
      callerName,
      ctx
    );

    // Build note
    const noteTitle = `${typeLabels[messageType]} — ${new Date().toISOString().split("T")[0]}`;
    const noteBody = [
      `**Tip:** ${typeLabels[messageType]}`,
      `**Arayan:** ${callerName || "Bilinmiyor"}`,
      `**Telefon:** ${phone}`,
      `**Mesaj:** ${messageText}`,
      `**Tarih:** ${new Date().toISOString()}`,
      `**Call ID:** ${ctx.callId}`,
    ].join("\n\n");

    // Write note to CRM
    const { noteId } = await crmService.writeCallNoteForBusiness(
      ctx.businessId,
      config,
      personId,
      noteTitle,
      noteBody,
      ctx
    );

    // Update memory — never block the call
    try {
      await memoryService.updateMemoryAfterCall(
        ctx.businessId, phone,
        {
          callerName,
          recentMessageSummary: `[${typeLabels[messageType]}] ${messageText.slice(0, 200)}`,
        },
        ctx
      );
    } catch (e) {
      logger.error("Memory update failed after take_message", {
        call_id: ctx.callId, business_id: ctx.businessId, action: "take_message_memory",
        status: "error", error: e instanceof Error ? e.message : String(e),
      });
    }

    // Type-specific responses
    const userMessages: Record<string, string> = {
      message: "Mesajınızı aldım efendim, en kısa sürede size dönüş yapılacaktır.",
      callback: "Geri arama talebinizi kaydettim efendim, size dönüş yapılacaktır.",
      urgent: (config.business.urgentEscalationConfig as { escalation_message?: string })?.escalation_message
        || "Talebinizi acil olarak ilettim efendim, en kısa sürede size dönüş yapılacaktır.",
    };

    return {
      result: "success",
      type: messageType,
      noteId,
      personId,
      user_message: userMessages[messageType],
    };
  } catch (error) {
    // Graceful degradation — CRM failure should never crash the call
    logger.error("CRM write failed in take_message", {
      call_id: ctx.callId,
      business_id: ctx.businessId,
      action: "take_message",
      status: "crm_failure",
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      result: "partial_success",
      type: messageType,
      user_message: "Mesajınızı aldım efendim, size dönüş yapılacaktır.",
    };
  }
}

async function handleGetCallerMemory(
  args: Record<string, unknown>,
  _config: ResolvedBusinessConfig,
  ctx: RequestContext
): Promise<HandlerResult> {
  const parsed = GetCallerMemoryArgsSchema.parse(args);
  const phone = parsed.callerPhone || parsed.caller_phone || ctx.callerPhone;

  if (!phone || phone === "unknown") {
    return {
      result: "no_memory",
      user_message: "Arayan bilgisi bulunamadı.",
    };
  }

  try {
    const memory = await memoryService.getCallerMemoryForBusiness(
      ctx.businessId, phone, ctx
    );

    if (!memory) {
      return {
        result: "no_memory",
        callerName: null,
        lastCallAt: null,
        recentAppointmentStatus: null,
        recentMessageSummary: null,
      };
    }

    return {
      result: "success",
      callerName: memory.callerName,
      lastCallAt: memory.lastCallAt?.toISOString() || null,
      recentAppointmentStatus: memory.recentAppointmentStatus,
      recentMessageSummary: memory.recentMessageSummary,
    };
  } catch (error) {
    logger.error("Memory read failed", {
      call_id: ctx.callId, business_id: ctx.businessId, action: "get_caller_memory",
      status: "error", error: error instanceof Error ? error.message : String(error),
    });
    return {
      result: "no_memory",
      callerName: null,
      lastCallAt: null,
      recentAppointmentStatus: null,
      recentMessageSummary: null,
    };
  }
}

async function handleGetBusinessHours(
  _args: Record<string, unknown>,
  config: ResolvedBusinessConfig,
  ctx: RequestContext
): Promise<HandlerResult> {
  const hours = config.business.operatingHours as Record<string, Array<{ open: string; close: string }>>;
  const timezone = config.business.timezone;

  const dayNames: Record<string, string> = {
    monday: "Pazartesi", tuesday: "Salı", wednesday: "Çarşamba",
    thursday: "Perşembe", friday: "Cuma", saturday: "Cumartesi", sunday: "Pazar",
  };

  const formatted: string[] = [];
  for (const [day, slots] of Object.entries(hours)) {
    const label = dayNames[day] || day;
    if (!slots || slots.length === 0) {
      formatted.push(`${label}: Kapalı`);
    } else {
      const ranges = slots.map((s) => `${s.open}-${s.close}`).join(", ");
      formatted.push(`${label}: ${ranges}`);
    }
  }

  logger.info("Business hours returned", {
    call_id: ctx.callId, business_id: ctx.businessId,
    action: "get_business_hours", status: "ok",
  });

  return {
    result: "success",
    hours,
    timezone,
    formatted: formatted.join("\n"),
    user_message: formatted.join(". ") + ".",
  };
}

async function handleGetEmergencyInfo(
  _args: Record<string, unknown>,
  config: ResolvedBusinessConfig,
  ctx: RequestContext
): Promise<HandlerResult> {
  const escalationConfig = config.business.urgentEscalationConfig as {
    situations?: string[];
    notify_contact?: string;
    response_time_promise?: string;
    escalation_message?: string;
  };

  logger.info("Emergency info returned", {
    call_id: ctx.callId, business_id: ctx.businessId,
    action: "get_emergency_info", status: "ok",
  });

  return {
    result: "success",
    situations: escalationConfig.situations || [],
    escalation_message: escalationConfig.escalation_message || "Talebinizi acil olarak ilettim efendim.",
    response_time_promise: escalationConfig.response_time_promise || null,
  };
}

const functionHandlers: Record<FunctionName, FunctionHandler> = {
  check_availability: handleCheckAvailability,
  create_booking: handleCreateBooking,
  cancel_booking: handleCancelBooking,
  lookup_bookings: handleLookupBookings,
  take_message: handleTakeMessage,
  get_caller_memory: handleGetCallerMemory,
  get_business_hours: handleGetBusinessHours,
  get_emergency_info: handleGetEmergencyInfo,
};

// ─── Single Entrypoint ───────────────────────────────────

router.post("/", verifyWebhookSignature, async (req, res) => {
  const startTime = Date.now();

  // Validate request body
  const parsed = RetellFunctionCallSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn("Invalid function call payload", {
      action: "retell_entrypoint",
      status: "validation_error",
      error: parsed.error.message,
    });
    res.status(400).json({
      result: "error",
      user_message: "Bir sorun oluştu efendim, tekrar deneyebilir misiniz?",
    });
    return;
  }

  const { name, args, call } = parsed.data;
  const callId = call.call_id;
  const agentId = call.agent_id;

  // Diagnostic log when agent_id is missing (Retell simulation calls)
  if (!agentId) {
    const rawCall = req.body?.call || {};
    logger.warn("agent_id missing from call payload (simulation?)", {
      call_id: callId,
      action: name,
      status: "agent_id_missing",
      raw_call_keys: Object.keys(rawCall),
      raw_top_level_keys: Object.keys(req.body || {}),
      conversation_flow_id: rawCall.conversation_flow_id || null,
      metadata_agent_id: rawCall.metadata?.agent_id || null,
    });
  }

  // Phone resolution: prefer telco caller ID, fallback to args (test calls / verbal collection)
  const argsObj = args as Record<string, unknown>;
  let callerPhone = call.from_number || "unknown";
  if (callerPhone === "unknown") {
    const argsPhone = (argsObj.callerPhone || argsObj.caller_phone) as string | undefined;
    if (argsPhone && argsPhone.length > 0 && !/^\{\{.+\}\}$/.test(argsPhone.trim())) {
      callerPhone = argsPhone;
    }
  }

  // Cache resolved phone for post-call pipeline
  cacheCallerPhone(callId, callerPhone);

  // Phone required for mutation operations — safety net (primary guard is Retell flow)
  const PHONE_REQUIRED_FUNCTIONS: FunctionName[] = [
    "create_booking", "cancel_booking", "lookup_bookings", "take_message",
  ];

  if (PHONE_REQUIRED_FUNCTIONS.includes(name) && (!callerPhone || callerPhone === "unknown")) {
    logger.warn("Phone required but missing", {
      call_id: callId,
      action: name,
      status: "phone_required",
    });
    res.status(200).json({
      result: "error",
      user_message: "Randevu işlemleri için telefon numaranıza ihtiyacım var efendim. Numaranızı söyleyebilir misiniz?",
    });
    return;
  }

  try {
    // Resolve business — fallback chain for simulation calls without agent_id
    let config: ResolvedBusinessConfig;
    const rawCall = req.body?.call || {};

    if (agentId) {
      // Primary path: agent_id present (real calls)
      config = await resolveBusiness(agentId, callId);
    } else {
      // Fallback chain for simulation calls
      const fallbackAgentId = rawCall.conversation_flow_id
        || rawCall.metadata?.agent_id
        || rawCall.metadata?.retell_agent_id;

      if (fallbackAgentId) {
        logger.info("Resolving business via fallback agent_id", {
          call_id: callId,
          action: name,
          status: "fallback_resolution",
          fallback_source: rawCall.conversation_flow_id ? "conversation_flow_id"
            : rawCall.metadata?.agent_id ? "metadata.agent_id"
            : "metadata.retell_agent_id",
          fallback_agent_id: fallbackAgentId,
        });
        config = await resolveBusiness(fallbackAgentId, callId);
      } else if (call.to_number) {
        // Last resort: resolve by called phone number
        logger.info("Resolving business via phone number fallback", {
          call_id: callId,
          action: name,
          status: "phone_fallback",
          to_number: call.to_number,
        });
        config = await resolveBusinessByPhone(call.to_number, callId);
      } else {
        throw new BusinessNotFoundError("no agent_id or fallback available");
      }
    }
    const businessId = config.business.id;

    // Create request context
    const ctx = createRequestContext({
      callId,
      businessId,
      functionName: name,
      callerPhone,
    });

    logger.info("Function call received", {
      call_id: callId,
      business_id: businessId,
      action: name,
      status: "processing",
      agent_id: agentId,
    });

    // Dispatch to handler
    const handler = functionHandlers[name];
    const result = await handler(args as Record<string, unknown>, config, ctx);

    const durationMs = Date.now() - startTime;
    logger.info("Function call completed", {
      call_id: callId,
      business_id: businessId,
      action: name,
      status: "ok",
      duration_ms: durationMs,
    });

    res.status(200).json(result);
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (error instanceof BusinessNotFoundError) {
      logger.error("Business resolution failed", {
        call_id: callId,
        action: name,
        status: "business_not_found",
        agent_id: agentId,
        duration_ms: durationMs,
      });
      res.status(200).json({
        result: "error",
        user_message: "Şu an yardımcı olamıyorum efendim, lütfen daha sonra tekrar arayın.",
      });
      return;
    }

    if (error instanceof LookupRequiredError) {
      logger.warn("Lookup required before mutation", {
        call_id: callId,
        action: name,
        status: "lookup_required",
        duration_ms: durationMs,
      });
      res.status(200).json({
        result: "error",
        user_message: "Önce randevularınızı kontrol etmem gerekiyor efendim, bir saniye.",
      });
      return;
    }

    if (error instanceof AppError) {
      logger.error("Function call failed", {
        call_id: callId,
        action: name,
        status: "error",
        error: error.message,
        error_code: error.code,
        duration_ms: durationMs,
      });
      res.status(200).json({
        result: "error",
        user_message: "Geçici bir sorun yaşıyorum efendim, mesajınızı alayım size dönüş yapalım.",
      });
      return;
    }

    // Unknown error — never expose raw stack to caller
    logger.error("Unexpected error in function call", {
      call_id: callId,
      action: name,
      status: "unexpected_error",
      error: error instanceof Error ? error.message : String(error),
      duration_ms: durationMs,
    });
    res.status(200).json({
      result: "error",
      user_message: "Teknik bir sorun yaşıyorum efendim, mesajınızı alayım size dönüş yapalım.",
    });
  }
});

export default router;
