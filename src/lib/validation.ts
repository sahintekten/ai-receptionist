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

export const CheckAvailabilityArgsSchema = z.object({
  dateRange: z.string().optional(),
  serviceType: z.string().optional(),
}).passthrough();

export const CreateBookingArgsSchema = z.object({
  callerPhone: z.string(),
  slot: z.string(),
  eventTypeId: z.union([z.string(), z.number()]),
  callerName: z.string().optional(),
}).passthrough();

export const CancelBookingArgsSchema = z.object({
  bookingId: z.string(),
  callerPhone: z.string(),
}).passthrough();

export const LookupBookingsArgsSchema = z.object({
  callerPhone: z.string(),
  name: z.string().optional(),
  dateHint: z.string().optional(),
}).passthrough();

export const TakeMessageArgsSchema = z.object({}).passthrough();
export const GetCallerMemoryArgsSchema = z.object({}).passthrough();
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
