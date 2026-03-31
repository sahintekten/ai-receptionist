import * as anthropic from "../integrations/anthropic";
import * as callLogService from "./callLog";
import * as crmService from "./crm";
import * as memoryService from "./memory";
import * as callLogRepo from "../repositories/callLog";
import { logger } from "../lib/logger";
import type { ResolvedBusinessConfig, AnthropicConfig } from "../types";
import type { RequestContext } from "../lib/requestContext";

function logContext(ctx: RequestContext) {
  return { call_id: ctx.callId, business_id: ctx.businessId };
}

export async function processPostCall(
  businessId: string,
  config: ResolvedBusinessConfig,
  callId: string,
  transcript: string | undefined,
  callMetadata: {
    callerPhone: string;
    callLogId?: string;
    disposition: string;
    detectedIntent?: string;
    bookingId?: string;
    durationSeconds?: number;
    crmNoteId?: string;
  },
  ctx: RequestContext
): Promise<void> {
  const startTime = Date.now();

  // Check if Anthropic API key is configured
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "placeholder") {
    logger.info("Opus processing skipped — ANTHROPIC_API_KEY not configured", {
      ...logContext(ctx),
      action: "opus_post_call",
      status: "skipped",
    });
    try {
      await callLogRepo.updateCallLog(callId, { postProcessingStatus: "skipped" });
    } catch { /* best effort */ }
    return;
  }

  // Skip if no transcript
  if (!transcript || transcript.trim().length === 0) {
    logger.info("Opus processing skipped — no transcript", {
      ...logContext(ctx),
      action: "opus_post_call",
      status: "skipped",
    });
    try {
      await callLogRepo.updateCallLog(callId, { postProcessingStatus: "skipped" });
    } catch { /* best effort */ }
    return;
  }

  // Get model config from integration_configs
  const anthropicIntegration = config.integrations.find((i) => i.type === "anthropic" && i.isEnabled);
  const modelConfig: anthropic.ModelConfig = anthropicIntegration
    ? (anthropicIntegration.config as AnthropicConfig)
    : {};

  logger.info("Opus post-call processing started", {
    ...logContext(ctx),
    action: "opus_post_call",
    status: "processing",
  });

  try {
    // Call Anthropic
    const result = await anthropic.generatePostCallSummary(
      transcript,
      {
        businessName: config.business.name,
        callerPhone: callMetadata.callerPhone,
        disposition: callMetadata.disposition,
        detectedIntent: callMetadata.detectedIntent,
        bookingId: callMetadata.bookingId,
        durationSeconds: callMetadata.durationSeconds,
      },
      modelConfig,
      logContext(ctx)
    );

    // Update call log with Opus results
    await callLogService.updateCallLogWithOpus(
      callId,
      result.summary,
      undefined,
      ctx
    );

    // Update orphaned booking flag if detected
    if (result.orphanedBookingFlag) {
      try {
        await callLogRepo.updateCallLog(callId, {
          orphanedBookingFlag: true,
        });
        logger.warn("Orphaned booking detected by Opus", {
          ...logContext(ctx),
          action: "opus_orphaned_booking",
          status: "flagged",
          details: result.orphanedBookingDetails,
        });
      } catch { /* best effort */ }
    }

    // Update CRM note with enriched content (if basic note was written)
    if (callMetadata.crmNoteId) {
      try {
        await crmService.updateCallNoteForBusiness(
          businessId, config,
          callMetadata.crmNoteId,
          undefined,
          result.enrichedNote,
          ctx
        );
      } catch (error) {
        logger.error("Failed to update CRM note with Opus enrichment", {
          ...logContext(ctx),
          action: "opus_crm_update",
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        // Basic note from Step 3 survives — this is acceptable
      }
    }

    // Update memory with Opus insights (stale guard in memory service)
    if (callMetadata.callerPhone && callMetadata.callerPhone !== "unknown") {
      try {
        await memoryService.updateMemoryAfterCall(
          businessId,
          callMetadata.callerPhone,
          {
            ...(callMetadata.callLogId ? { lastCallId: callMetadata.callLogId } : {}),
            recentMessageSummary: result.summary,
          },
          ctx
        );
      } catch (error) {
        logger.error("Opus memory update failed", {
          ...logContext(ctx),
          action: "opus_memory_update",
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue — memory failure is non-critical
      }
    }

    logger.info("Opus post-call processing completed", {
      ...logContext(ctx),
      action: "opus_post_call",
      status: "ok",
      duration_ms: Date.now() - startTime,
      orphaned_booking: result.orphanedBookingFlag,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error("Opus post-call processing failed", {
      ...logContext(ctx),
      action: "opus_post_call",
      status: "failed",
      duration_ms: durationMs,
      error: errorMsg,
    });

    // Record failure in call log
    try {
      await callLogRepo.updateCallLog(callId, {
        postProcessingStatus: "failed",
        opusFailureReason: errorMsg,
      });
    } catch { /* best effort */ }
  }
}
