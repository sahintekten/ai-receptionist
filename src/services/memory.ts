import * as memoryRepo from "../repositories/memory";
import { logger } from "../lib/logger";
import type { RequestContext } from "../lib/requestContext";

function logContext(ctx: RequestContext) {
  return { call_id: ctx.callId, business_id: ctx.businessId };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  ctx: RequestContext,
  action: string
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn("Memory DB retry attempt", {
      ...logContext(ctx),
      action,
      status: "retrying",
      error: error instanceof Error ? error.message : String(error),
    });
    return await fn();
  }
}

// ─── Get Caller Memory ──────────────────────────────────

export interface CallerMemoryData {
  callerName: string | null;
  lastCallAt: Date | null;
  recentAppointmentStatus: string | null;
  recentMessageSummary: string | null;
}

export async function getCallerMemoryForBusiness(
  businessId: string,
  callerPhone: string,
  ctx: RequestContext
): Promise<CallerMemoryData | null> {
  const startTime = Date.now();

  logger.info("Reading caller memory", {
    ...logContext(ctx),
    action: "get_caller_memory",
    status: "processing",
  });

  const memory = await withRetry(
    () => memoryRepo.getByBusinessAndPhone(businessId, callerPhone),
    ctx,
    "get_caller_memory"
  );

  logger.info("Caller memory read", {
    ...logContext(ctx),
    action: "get_caller_memory",
    status: memory ? "found" : "not_found",
    duration_ms: Date.now() - startTime,
  });

  if (!memory) return null;

  return {
    callerName: memory.callerName,
    lastCallAt: memory.lastCallAt,
    recentAppointmentStatus: memory.recentAppointmentStatus,
    recentMessageSummary: memory.recentMessageSummary,
  };
}

// ─── Update Memory After Call ────────────────────────────

export interface MemoryUpdate {
  callerName?: string;
  lastCallId: string;
  lastCallAt?: Date;
  recentAppointmentStatus?: string;
  recentMessageSummary?: string;
  rawPhone?: string;
}

export async function updateMemoryAfterCall(
  businessId: string,
  callerPhone: string,
  updates: MemoryUpdate,
  ctx: RequestContext
): Promise<void> {
  const startTime = Date.now();

  logger.info("Updating caller memory", {
    ...logContext(ctx),
    action: "update_memory",
    status: "processing",
  });

  // Stale overwrite guard: check if a newer call already updated memory
  const existing = await memoryRepo.getByBusinessAndPhone(businessId, callerPhone);
  if (existing && existing.lastCallId && existing.lastCallId !== updates.lastCallId) {
    // Another call already updated memory — check if it's newer
    if (existing.lastCallAt && updates.lastCallAt && existing.lastCallAt > updates.lastCallAt) {
      logger.warn("Stale memory update skipped — newer call already updated", {
        ...logContext(ctx),
        action: "update_memory",
        status: "skipped_stale",
        existing_call_id: existing.lastCallId,
        duration_ms: Date.now() - startTime,
      });
      return;
    }
  }

  const data: Parameters<typeof memoryRepo.upsertMemory>[2] = {
    lastCallId: updates.lastCallId,
    lastCallAt: updates.lastCallAt || new Date(),
  };

  // Only update fields that are provided
  if (updates.callerName) data.callerName = updates.callerName;
  if (updates.recentAppointmentStatus) data.recentAppointmentStatus = updates.recentAppointmentStatus;
  if (updates.recentMessageSummary) data.recentMessageSummary = updates.recentMessageSummary;
  if (updates.rawPhone) data.rawPhone = updates.rawPhone;

  await withRetry(
    () => memoryRepo.upsertMemory(businessId, callerPhone, data),
    ctx,
    "update_memory"
  );

  logger.info("Caller memory updated", {
    ...logContext(ctx),
    action: "update_memory",
    status: "ok",
    duration_ms: Date.now() - startTime,
  });
}
