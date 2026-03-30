import * as callLogRepo from "../repositories/callLog";
import { logger } from "../lib/logger";
import type { RequestContext } from "../lib/requestContext";
import type { Disposition, LastStep, CrmWriteStatus } from "@prisma/client";

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
    logger.warn("CallLog DB retry attempt", {
      ...logContext(ctx),
      action,
      status: "retrying",
      error: error instanceof Error ? error.message : String(error),
    });
    return await fn();
  }
}

// ─── Write Call Log ──────────────────────────────────────

export interface CallLogData {
  callId: string;
  businessId: string;
  agentId: string;
  callerPhone: string;
  rawPhone?: string;
  startedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  disposition?: Disposition;
  lastStep?: LastStep;
  detectedIntent?: string;
  rawTranscript?: string;
  bookingId?: string;
  messageText?: string;
}

export async function writeCallLogForBusiness(
  businessId: string,
  callData: CallLogData,
  ctx: RequestContext
): Promise<{ created: boolean }> {
  const startTime = Date.now();

  logger.info("Writing call log", {
    ...logContext(ctx),
    action: "write_call_log",
    status: "processing",
    disposition: callData.disposition,
    last_step: callData.lastStep,
  });

  const { created } = await withRetry(
    () => callLogRepo.createCallLog({
      callId: callData.callId,
      business: { connect: { id: businessId } },
      agentId: callData.agentId,
      callerPhone: callData.callerPhone,
      rawPhone: callData.rawPhone,
      startedAt: callData.startedAt,
      endedAt: callData.endedAt,
      durationSeconds: callData.durationSeconds,
      disposition: callData.disposition,
      lastStep: callData.lastStep,
      detectedIntent: callData.detectedIntent,
      rawTranscript: callData.rawTranscript,
      bookingId: callData.bookingId,
      messageText: callData.messageText,
    }),
    ctx,
    "write_call_log"
  );

  if (!created) {
    logger.info("Duplicate call log skipped (idempotent)", {
      ...logContext(ctx),
      action: "write_call_log",
      status: "duplicate_skipped",
      duration_ms: Date.now() - startTime,
    });
  } else {
    logger.info("Call log written", {
      ...logContext(ctx),
      action: "write_call_log",
      status: "ok",
      duration_ms: Date.now() - startTime,
      disposition: callData.disposition,
      last_step: callData.lastStep,
      duration_seconds: callData.durationSeconds,
    });
  }

  return { created };
}

// ─── Update Call Log (Opus / CRM) ────────────────────────

export async function updateCallLogAfterCrm(
  callId: string,
  crmWriteStatus: CrmWriteStatus,
  crmNoteId: string | undefined,
  ctx: RequestContext
): Promise<void> {
  await withRetry(
    () => callLogRepo.updateCallLog(callId, {
      crmWriteStatus,
      crmNoteId: crmNoteId || undefined,
    }),
    ctx,
    "update_call_log_crm"
  );

  logger.info("Call log updated with CRM status", {
    ...logContext(ctx),
    action: "update_call_log_crm",
    status: "ok",
    crm_write_status: crmWriteStatus,
  });
}

export async function updateCallLogWithOpus(
  callId: string,
  opusSummary: string,
  crmNoteId: string | undefined,
  ctx: RequestContext
): Promise<void> {
  const startTime = Date.now();

  await withRetry(
    () => callLogRepo.updateCallLog(callId, {
      opusSummary,
      postProcessingStatus: "completed",
      ...(crmNoteId && { crmNoteId }),
    }),
    ctx,
    "update_call_log_opus"
  );

  logger.info("Call log updated with Opus results", {
    ...logContext(ctx),
    action: "update_call_log_opus",
    status: "ok",
    duration_ms: Date.now() - startTime,
  });
}

// ─── Usage Tracking Queries ──────────────────────────────

export async function getCallLogsForBusiness(
  businessId: string,
  options?: { limit?: number; offset?: number; startDate?: Date; endDate?: Date }
): Promise<ReturnType<typeof callLogRepo.getByBusinessId>> {
  return callLogRepo.getByBusinessId(businessId, options);
}
