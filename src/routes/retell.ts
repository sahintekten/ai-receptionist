import { Router } from "express";
import { verifyWebhookSignature } from "../middleware/auth";
import { resolveBusiness } from "../resolver/businessResolver";
import { createRequestContext } from "../lib/requestContext";
import {
  RetellFunctionCallSchema,
  CheckAvailabilityArgsSchema,
  CreateBookingArgsSchema,
  CancelBookingArgsSchema,
  LookupBookingsArgsSchema,
  TakeMessageArgsSchema,
  type FunctionName,
} from "../lib/validation";
import { logger } from "../lib/logger";
import { AppError, BusinessNotFoundError, IntegrationError, LookupRequiredError } from "../lib/errors";
import * as bookingService from "../services/booking";
import * as crmService from "../services/crm";
import type { ResolvedBusinessConfig } from "../types";
import type { RequestContext } from "../lib/requestContext";

const router = Router();

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
  if (lookupTracker.size > 10_000) {
    lookupTracker.clear();
  }
}, 60 * 60 * 1000);

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

  // Default: next 3 days from now
  const now = new Date();
  const defaultEnd = new Date(now);
  defaultEnd.setDate(defaultEnd.getDate() + 3);

  let startDate = now.toISOString();
  let endDate = defaultEnd.toISOString();

  if (parsed.dateRange) {
    // dateRange could be an ISO date string or a date range
    startDate = new Date(parsed.dateRange).toISOString();
    const rangeEnd = new Date(parsed.dateRange);
    rangeEnd.setDate(rangeEnd.getDate() + 1);
    endDate = rangeEnd.toISOString();
  }

  const result = await bookingService.checkAvailabilityForBusiness(
    ctx.businessId,
    config,
    { start: startDate, end: endDate },
    parsed.serviceType,
    ctx
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
  const eventTypeId = typeof parsed.eventTypeId === "string"
    ? parseInt(parsed.eventTypeId, 10)
    : parsed.eventTypeId;

  try {
    const result = await bookingService.createBookingForBusiness(
      ctx.businessId,
      config,
      parsed.callerPhone,
      parsed.slot,
      eventTypeId,
      parsed.callerName || "Arayan",
      ctx
    );

    return {
      result: "success",
      bookingUid: result.bookingUid,
      title: result.title,
      start: result.start,
      end: result.end,
      user_message: `Randevunuz oluşturuldu efendim. ${result.start} tarihinde sizi bekliyoruz.`,
    };
  } catch (error) {
    if (error instanceof IntegrationError && error.context?.httpStatus === 409) {
      // Booking conflict — slot taken, re-query availability
      logger.warn("Booking conflict, re-querying availability", {
        call_id: ctx.callId,
        business_id: ctx.businessId,
        action: "create_booking",
        status: "conflict",
      });

      return {
        result: "conflict",
        user_message: "Bu randevu slotu az önce doldu efendim. Müsait başka slotlara bakayım hemen.",
      };
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

  const result = await bookingService.cancelBookingForBusiness(
    ctx.businessId,
    config,
    parsed.bookingId,
    parsed.callerPhone,
    ctx
  );

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

  const result = await bookingService.lookupBookingsForBusiness(
    ctx.businessId,
    config,
    parsed.callerPhone,
    parsed.name,
    parsed.dateHint,
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
  const messageType = parsed.type;

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
      parsed.callerPhone,
      parsed.callerName,
      ctx
    );

    // Build note
    const noteTitle = `${typeLabels[messageType]} — ${new Date().toISOString().split("T")[0]}`;
    const noteBody = [
      `**Tip:** ${typeLabels[messageType]}`,
      `**Arayan:** ${parsed.callerName || "Bilinmiyor"}`,
      `**Telefon:** ${parsed.callerPhone}`,
      `**Mesaj:** ${parsed.messageText}`,
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
  _args: Record<string, unknown>,
  _config: ResolvedBusinessConfig,
  _ctx: RequestContext
): Promise<HandlerResult> {
  return { result: "not_implemented", message: "get_caller_memory not implemented yet" };
}

async function handleGetBusinessHours(
  _args: Record<string, unknown>,
  _config: ResolvedBusinessConfig,
  _ctx: RequestContext
): Promise<HandlerResult> {
  return { result: "not_implemented", message: "get_business_hours not implemented yet" };
}

async function handleGetEmergencyInfo(
  _args: Record<string, unknown>,
  _config: ResolvedBusinessConfig,
  _ctx: RequestContext
): Promise<HandlerResult> {
  return { result: "not_implemented", message: "get_emergency_info not implemented yet" };
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
  const callerPhone = call.from_number || "unknown";

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
    // Resolve business from agent_id
    const config = await resolveBusiness(agentId, callId);
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
