import { IntegrationError } from "../lib/errors";
import { logger } from "../lib/logger";

const CALCOM_BASE_URL = "https://api.cal.com/v2";
const TIMEOUT_MS = 10_000;
const SLOTS_API_VERSION = "2024-09-04";
const BOOKINGS_API_VERSION = "2024-08-13";

function getApiKey(): string {
  const key = process.env.CALCOM_API_KEY;
  if (!key) throw new IntegrationError("Cal.com", "CALCOM_API_KEY not configured");
  return key;
}

function headers(apiVersion: string): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "cal-api-version": apiVersion,
    "Content-Type": "application/json",
  };
}

async function calcomFetch<T>(
  path: string,
  options: RequestInit & { apiVersion?: string },
  context?: { call_id?: string; business_id?: string; action?: string }
): Promise<T> {
  const { apiVersion = BOOKINGS_API_VERSION, ...fetchOptions } = options;
  const url = `${CALCOM_BASE_URL}${path}`;
  const startTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers: { ...headers(apiVersion), ...fetchOptions.headers as Record<string, string> },
      signal: controller.signal,
    });

    const durationMs = Date.now() - startTime;
    const body = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      logger.error("Cal.com API error", {
        call_id: context?.call_id,
        business_id: context?.business_id,
        action: context?.action,
        status: "error",
        duration_ms: durationMs,
        http_status: response.status,
        error: JSON.stringify(body),
      });

      if (response.status === 409) {
        throw new IntegrationError("Cal.com", "Booking conflict — slot no longer available", {
          httpStatus: 409,
        });
      }

      throw new IntegrationError(
        "Cal.com",
        `API returned ${response.status}`,
        { httpStatus: response.status, body }
      );
    }

    logger.debug("Cal.com API success", {
      call_id: context?.call_id,
      business_id: context?.business_id,
      action: context?.action,
      status: "ok",
      duration_ms: durationMs,
    });

    return body as T;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;

    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof Error && error.name === "AbortError";

    logger.error("Cal.com API failure", {
      call_id: context?.call_id,
      business_id: context?.business_id,
      action: context?.action,
      status: isTimeout ? "timeout" : "error",
      duration_ms: durationMs,
      error: message,
    });

    throw new IntegrationError("Cal.com", isTimeout ? "Request timed out" : message);
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  context?: { call_id?: string; business_id?: string; action?: string }
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn("Cal.com retry attempt", {
      call_id: context?.call_id,
      business_id: context?.business_id,
      action: context?.action,
      status: "retrying",
    });
    return await fn();
  }
}

// ─── Public API ──────────────────────────────────────────

export interface CalcomSlot {
  start: string;
  end: string;
}

export interface CalcomSlotsResponse {
  status: string;
  data: Record<string, CalcomSlot[]>;
}

export async function getAvailability(
  eventTypeId: number,
  startDate: string,
  endDate: string,
  timeZone: string = "Europe/Istanbul",
  context?: { call_id?: string; business_id?: string }
): Promise<Record<string, CalcomSlot[]>> {
  const params = new URLSearchParams({
    eventTypeId: String(eventTypeId),
    start: startDate,
    end: endDate,
    timeZone,
    format: "range",
  });

  // Availability reads: 1 retry allowed
  const result = await withRetry(
    () => calcomFetch<CalcomSlotsResponse>(
      `/slots?${params}`,
      { method: "GET", apiVersion: SLOTS_API_VERSION },
      { ...context, action: "calcom_get_availability" }
    ),
    { ...context, action: "calcom_get_availability" }
  );

  return result.data;
}

export interface CalcomBooking {
  id: number;
  uid: string;
  title: string;
  start: string;
  end: string;
  status: string;
  attendees: Array<{ name: string; email: string; timeZone: string }>;
  hosts?: Array<{ name: string }>;
}

export interface CalcomBookingResponse {
  status: string;
  data: CalcomBooking;
}

export async function createBooking(
  eventTypeId: number,
  start: string,
  attendeeName: string,
  attendeeEmail: string,
  attendeePhone: string,
  timeZone: string = "Europe/Istanbul",
  context?: { call_id?: string; business_id?: string }
): Promise<CalcomBooking> {
  // NO retry for booking create — double booking risk
  const result = await calcomFetch<CalcomBookingResponse>(
    "/bookings",
    {
      method: "POST",
      body: JSON.stringify({
        eventTypeId,
        start,
        attendee: {
          name: attendeeName,
          email: attendeeEmail,
          timeZone,
        },
        location: {
          type: "phone",
          value: attendeePhone,
        },
        metadata: {
          source: "ai-receptionist",
        },
      }),
    },
    { ...context, action: "calcom_create_booking" }
  );

  return result.data;
}

export interface CalcomCancelResponse {
  status: string;
  data: CalcomBooking;
}

export async function cancelBooking(
  bookingUid: string,
  cancellationReason?: string,
  context?: { call_id?: string; business_id?: string }
): Promise<CalcomBooking> {
  // Cancel: 1 retry allowed
  const result = await withRetry(
    () => calcomFetch<CalcomCancelResponse>(
      `/bookings/${bookingUid}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({
          cancellationReason: cancellationReason || "Cancelled by caller via AI receptionist",
        }),
      },
      { ...context, action: "calcom_cancel_booking" }
    ),
    { ...context, action: "calcom_cancel_booking" }
  );

  return result.data;
}

export interface CalcomBookingsListResponse {
  status: string;
  data: CalcomBooking[];
}

export async function getBookings(
  filters: {
    attendeeEmail?: string;
    attendeeName?: string;
    eventTypeId?: number;
    status?: string[];
    afterStart?: string;
    take?: number;
    sortStart?: "asc" | "desc";
  },
  context?: { call_id?: string; business_id?: string }
): Promise<CalcomBooking[]> {
  const params = new URLSearchParams();

  if (filters.attendeeEmail) params.set("attendeeEmail", filters.attendeeEmail);
  if (filters.attendeeName) params.set("attendeeName", filters.attendeeName);
  if (filters.eventTypeId) params.set("eventTypeId", String(filters.eventTypeId));
  if (filters.status) params.set("status", filters.status.join(","));
  if (filters.afterStart) params.set("afterStart", filters.afterStart);
  if (filters.take) params.set("take", String(filters.take));
  if (filters.sortStart) params.set("sortStart", filters.sortStart);

  // Booking reads: 1 retry allowed
  const result = await withRetry(
    () => calcomFetch<CalcomBookingsListResponse>(
      `/bookings?${params}`,
      { method: "GET" },
      { ...context, action: "calcom_get_bookings" }
    ),
    { ...context, action: "calcom_get_bookings" }
  );

  return result.data;
}
