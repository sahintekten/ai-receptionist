import * as calcom from "../integrations/calcom";
import { IntegrationError, BookingOwnershipError } from "../lib/errors";
import { logger } from "../lib/logger";
import type { ResolvedBusinessConfig, CalcomConfig } from "../types";
import type { RequestContext } from "../lib/requestContext";

function getCalcomConfig(config: ResolvedBusinessConfig): CalcomConfig {
  const calcomIntegration = config.integrations.find((i) => i.type === "calcom");
  if (!calcomIntegration || !calcomIntegration.isEnabled) {
    throw new IntegrationError("Cal.com", "Cal.com integration not configured for this business");
  }
  return calcomIntegration.config as CalcomConfig;
}

function logContext(ctx: RequestContext) {
  return { call_id: ctx.callId, business_id: ctx.businessId };
}

// ─── Check Availability ──────────────────────────────────

export interface AvailableSlot {
  start: string;
  end: string;
}

export interface AvailabilityResult {
  slots: Record<string, AvailableSlot[]>;
  eventTypeId: number;
  eventTypeName: string;
}

export async function checkAvailabilityForBusiness(
  businessId: string,
  config: ResolvedBusinessConfig,
  dateRange: { start: string; end: string },
  serviceType: string | undefined,
  ctx: RequestContext,
  doctorName?: string
): Promise<AvailabilityResult> {
  const calcomConfig = getCalcomConfig(config);
  const timezone = config.business.timezone;

  // Find the right event type — priority: doctorName > serviceType > single default
  let eventType: typeof calcomConfig.event_types[number] | undefined;

  // 1. Doctor name match (highest priority)
  if (doctorName) {
    const search = doctorName.toLowerCase();
    eventType = calcomConfig.event_types.find(
      (et) => et.doctor_name?.toLowerCase().includes(search)
    );
  }

  // 2. Service type match
  if (!eventType && serviceType) {
    const search = serviceType.toLowerCase();
    // 2a. Exact service_type match
    eventType = calcomConfig.event_types.find(
      (et) => et.service_type.toLowerCase() === search
    );
    // 2b. Partial service_type or name match
    if (!eventType) {
      eventType = calcomConfig.event_types.find(
        (et) => et.service_type.toLowerCase().includes(search)
          || et.name.toLowerCase().includes(search)
      );
    }
  }

  // 3. No search terms and single event type → use it as default
  if (!eventType && !doctorName && !serviceType && calcomConfig.event_types.length === 1) {
    eventType = calcomConfig.event_types[0];
  }

  if (!eventType) {
    throw new IntegrationError("Cal.com", "Uygun randevu türü bulunamadı");
  }

  logger.info("Checking availability", {
    ...logContext(ctx),
    action: "check_availability",
    status: "processing",
    event_type_id: eventType.id,
  });

  const slots = await calcom.getAvailability(
    eventType.id,
    dateRange.start,
    dateRange.end,
    timezone,
    logContext(ctx)
  );

  const totalSlots = Object.values(slots).reduce((sum, daySlots) => sum + daySlots.length, 0);

  logger.info("Availability check complete", {
    ...logContext(ctx),
    action: "check_availability",
    status: "ok",
    duration_ms: Date.now() - ctx.startTime,
    total_slots: totalSlots,
  });

  return {
    slots,
    eventTypeId: eventType.id,
    eventTypeName: eventType.name,
  };
}

// ─── Create Booking ──────────────────────────────────────

export interface BookingResult {
  bookingId: number;
  bookingUid: string;
  title: string;
  start: string;
  end: string;
  status: string;
}

export async function createBookingForBusiness(
  businessId: string,
  config: ResolvedBusinessConfig,
  callerPhone: string,
  slot: string,
  eventTypeId: number,
  callerName: string,
  ctx: RequestContext,
  requestedService?: string
): Promise<BookingResult> {
  const timezone = config.business.timezone;

  // Generate a deterministic email from phone for Cal.com (required field)
  const sanitizedPhone = callerPhone.replace(/[^0-9]/g, "");
  const attendeeEmail = `caller_${sanitizedPhone}@phone.aireceptionist.local`;

  logger.info("Creating booking", {
    ...logContext(ctx),
    action: "create_booking",
    status: "processing",
    event_type_id: eventTypeId,
    slot,
    attendee_email: attendeeEmail,
    caller_phone: callerPhone,
    timezone,
  });

  // NO retry — double booking risk
  const booking = await calcom.createBooking(
    eventTypeId,
    slot,
    callerName || "Arayan",
    attendeeEmail,
    callerPhone,
    timezone,
    logContext(ctx),
    requestedService
  );

  logger.info("Booking created", {
    ...logContext(ctx),
    action: "create_booking",
    status: "ok",
    duration_ms: Date.now() - ctx.startTime,
    booking_uid: booking.uid,
  });

  return {
    bookingId: booking.id,
    bookingUid: booking.uid,
    title: booking.title,
    start: booking.start,
    end: booking.end,
    status: booking.status,
  };
}

// ─── Cancel Booking ──────────────────────────────────────

export async function cancelBookingForBusiness(
  businessId: string,
  config: ResolvedBusinessConfig,
  bookingUid: string,
  callerPhone: string,
  ctx: RequestContext,
  skipOwnershipCheck = false
): Promise<{ cancelled: boolean; bookingUid: string }> {
  // Verify booking ownership unless already verified by prior lookup
  if (!skipOwnershipCheck) {
    const sanitizedPhone = callerPhone.replace(/[^0-9]/g, "");
    const attendeeEmail = `caller_${sanitizedPhone}@phone.aireceptionist.local`;

    const existingBookings = await calcom.getBookings(
      { attendeeEmail, status: ["upcoming"] },
      logContext(ctx)
    );

    const targetBooking = existingBookings.find((b) => b.uid === bookingUid);
    if (!targetBooking) {
      throw new BookingOwnershipError();
    }
  }

  logger.info("Cancelling booking", {
    ...logContext(ctx),
    action: "cancel_booking",
    status: "processing",
    booking_uid: bookingUid,
  });

  await calcom.cancelBooking(
    bookingUid,
    "Arayan tarafından iptal edildi",
    logContext(ctx)
  );

  logger.info("Booking cancelled", {
    ...logContext(ctx),
    action: "cancel_booking",
    status: "ok",
    duration_ms: Date.now() - ctx.startTime,
    booking_uid: bookingUid,
  });

  return { cancelled: true, bookingUid };
}

// ─── Lookup Bookings ─────────────────────────────────────

export interface BookingLookupResult {
  bookings: Array<{
    bookingUid: string;
    title: string;
    start: string;
    end: string;
    status: string;
    hostName?: string;
  }>;
}

export async function lookupBookingsForBusiness(
  businessId: string,
  config: ResolvedBusinessConfig,
  callerPhone: string,
  name: string | undefined,
  dateHint: string | undefined,
  ctx: RequestContext
): Promise<BookingLookupResult> {
  logger.info("Looking up bookings", {
    ...logContext(ctx),
    action: "lookup_bookings",
    status: "processing",
    has_phone: callerPhone !== "unknown",
    has_name: !!name,
    has_date_hint: !!dateHint,
  });

  let bookings: Awaited<ReturnType<typeof calcom.getBookings>> = [];
  let lookupMethod = "none";

  // Bridge 1: Phone-based lookup
  if (callerPhone && callerPhone !== "unknown") {
    const sanitizedPhone = callerPhone.replace(/[^0-9]/g, "");
    const attendeeEmail = `caller_${sanitizedPhone}@phone.aireceptionist.local`;
    const filters: Parameters<typeof calcom.getBookings>[0] = {
      attendeeEmail,
      status: ["upcoming"],
      take: 10,
      sortStart: "asc",
    };
    if (dateHint) filters.afterStart = dateHint;

    bookings = await calcom.getBookings(filters, logContext(ctx));
    if (bookings.length > 0) lookupMethod = "phone";
  }

  // Bridge 2: Name-based lookup
  if (bookings.length === 0 && name) {
    const filters: Parameters<typeof calcom.getBookings>[0] = {
      attendeeName: name,
      status: ["upcoming"],
      take: 10,
      sortStart: "asc",
    };
    if (dateHint) filters.afterStart = dateHint;

    bookings = await calcom.getBookings(filters, logContext(ctx));
    if (bookings.length > 0) lookupMethod = "name";
  }

  // Bridge 3: Date-based with client-side name filter
  if (bookings.length === 0 && dateHint) {
    const filters: Parameters<typeof calcom.getBookings>[0] = {
      status: ["upcoming"],
      afterStart: dateHint,
      take: 20,
      sortStart: "asc",
    };

    const allBookings = await calcom.getBookings(filters, logContext(ctx));
    if (name) {
      const searchName = name.toLowerCase();
      bookings = allBookings.filter((b) =>
        b.attendees?.some((a) => a.name.toLowerCase().includes(searchName))
      );
    }
    if (bookings.length > 0) lookupMethod = "date_filter";
  }

  // Max 3 results for voice disambiguation
  const filtered = bookings.slice(0, 3);

  logger.info("Bookings lookup complete", {
    ...logContext(ctx),
    action: "lookup_bookings",
    status: "ok",
    duration_ms: Date.now() - ctx.startTime,
    results_count: filtered.length,
    lookup_method: lookupMethod,
  });

  return {
    bookings: filtered.map((b) => ({
      bookingUid: b.uid,
      title: b.title,
      start: b.start,
      end: b.end,
      status: b.status,
      hostName: b.hosts?.[0]?.name,
    })),
  };
}
