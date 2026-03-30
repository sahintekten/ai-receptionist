import { z } from "zod";

// ─── Retell Call Object ──────────────────────────────────

const RetellCallSchema = z.object({
  call_id: z.string(),
  agent_id: z.string(),
  call_type: z.string().optional(),
  from_number: z.string().optional(),
  to_number: z.string().optional(),
  direction: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
}).passthrough();

// ─── Function Args Schemas ───────────────────────────────

// All schemas accept both camelCase and snake_case — Retell sends snake_case

export const CheckAvailabilityArgsSchema = z.object({
  dateRange: z.string().optional(),
  date_range: z.string().optional(),
  preferred_date: z.string().optional(),
  preferred_time: z.string().optional(),
  serviceType: z.string().optional(),
  service_type: z.string().optional(),
  doctor_name: z.string().optional(),
}).passthrough();

export const CreateBookingArgsSchema = z.object({
  callerPhone: z.string().optional(),
  caller_phone: z.string().optional(),
  slot: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  eventTypeId: z.union([z.string(), z.number()]).optional(),
  service_type: z.string().optional(),
  callerName: z.string().optional(),
  caller_name: z.string().optional(),
  doctor_name: z.string().optional(),
}).passthrough();

export const CancelBookingArgsSchema = z.object({
  bookingId: z.string().optional(),
  booking_id: z.string().optional(),
  callerPhone: z.string().optional(),
  caller_phone: z.string().optional(),
}).passthrough();

export const LookupBookingsArgsSchema = z.object({
  callerPhone: z.string().optional(),
  caller_phone: z.string().optional(),
  name: z.string().optional(),
  caller_name: z.string().optional(),
  dateHint: z.string().optional(),
  date_hint: z.string().optional(),
}).passthrough();

export const TakeMessageArgsSchema = z.object({
  callerPhone: z.string().optional(),
  caller_phone: z.string().optional(),
  messageText: z.string().optional(),
  message: z.string().optional(),
  callerName: z.string().optional(),
  caller_name: z.string().optional(),
  type: z.enum(["message", "callback", "urgent"]).default("message"),
  message_type: z.string().optional(),
}).passthrough();

export const GetCallerMemoryArgsSchema = z.object({
  callerPhone: z.string().optional(),
  caller_phone: z.string().optional(),
}).passthrough();
export const GetBusinessHoursArgsSchema = z.object({}).passthrough();
export const GetEmergencyInfoArgsSchema = z.object({}).passthrough();

// ─── Function Name Enum ──────────────────────────────────

export const FUNCTION_NAMES = [
  "check_availability",
  "create_booking",
  "cancel_booking",
  "lookup_bookings",
  "take_message",
  "get_caller_memory",
  "get_business_hours",
  "get_emergency_info",
] as const;

export type FunctionName = (typeof FUNCTION_NAMES)[number];

// ─── Main Request Schema ─────────────────────────────────

export const RetellFunctionCallSchema = z.object({
  name: z.enum(FUNCTION_NAMES),
  args: z.record(z.unknown()).default({}),
  call: RetellCallSchema,
});

export type RetellFunctionCall = z.infer<typeof RetellFunctionCallSchema>;

// ─── Args Schema Map ─────────────────────────────────────

export const argsSchemaMap: Record<FunctionName, z.ZodTypeAny> = {
  check_availability: CheckAvailabilityArgsSchema,
  create_booking: CreateBookingArgsSchema,
  cancel_booking: CancelBookingArgsSchema,
  lookup_bookings: LookupBookingsArgsSchema,
  take_message: TakeMessageArgsSchema,
  get_caller_memory: GetCallerMemoryArgsSchema,
  get_business_hours: GetBusinessHoursArgsSchema,
  get_emergency_info: GetEmergencyInfoArgsSchema,
};

// ─── Retell call.completed Webhook Schema ────────────────

export const RetellCallCompletedSchema = z.object({
  event: z.string(),
  call: z.object({
    call_id: z.string(),
    agent_id: z.string(),
    call_type: z.string().optional(),
    from_number: z.string().optional(),
    to_number: z.string().optional(),
    direction: z.string().optional(),
    start_timestamp: z.number().optional(),
    end_timestamp: z.number().optional(),
    duration_ms: z.number().optional(),
    transcript: z.string().optional(),
    transcript_object: z.array(z.record(z.unknown())).optional(),
    recording_url: z.string().optional(),
    disconnection_reason: z.string().optional(),
    call_analysis: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  }).passthrough(),
}).passthrough();

export type RetellCallCompleted = z.infer<typeof RetellCallCompletedSchema>;
