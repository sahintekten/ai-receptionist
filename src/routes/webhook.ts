import { Router } from "express";
import { verifyWebhookSignature } from "../middleware/auth";
import { resolveBusiness } from "../resolver/businessResolver";
import { createRequestContext } from "../lib/requestContext";
import { RetellCallCompletedSchema } from "../lib/validation";
import { logger } from "../lib/logger";
import * as callLogService from "../services/callLog";
import * as memoryService from "../services/memory";
import * as crmService from "../services/crm";
import type { Disposition, LastStep } from "@prisma/client";

const router = Router();

// ─── Disposition Mapping ─────────────────────────────────

function mapDisposition(disconnectionReason?: string): Disposition {
  if (!disconnectionReason) return "completed";
  const reason = disconnectionReason.toLowerCase();
  if (reason.includes("agent_hangup") || reason.includes("call_ended")) return "completed";
  if (reason.includes("user_hangup")) return "interrupted";
  if (reason.includes("error") || reason.includes("failure")) return "failed";
  if (reason.includes("no_answer") || reason.includes("voicemail")) return "no_answer";
  return "completed";
}

// ─── POST /webhook/call-completed ────────────────────────

router.post("/call-completed", verifyWebhookSignature, async (req, res) => {
  const startTime = Date.now();

  // Validate webhook payload
  const parsed = RetellCallCompletedSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn("Invalid call-completed webhook payload", {
      action: "webhook_call_completed",
      status: "validation_error",
      error: parsed.error.message,
    });
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const { call } = parsed.data;
  const callId = call.call_id;
  const agentId = call.agent_id;
  const callerPhone = call.from_number || "unknown";

  try {
    // Resolve business
    const config = await resolveBusiness(agentId, callId);
    const businessId = config.business.id;

    const ctx = createRequestContext({
      callId,
      businessId,
      functionName: "post_call_pipeline",
      callerPhone,
    });

    logger.info("Post-call pipeline started", {
      ...logCtx(ctx),
      action: "post_call_pipeline",
      status: "started",
      agent_id: agentId,
    });

    // ─── Step 1: Write call log (idempotent) ─────────────
    const startMs = call.start_timestamp ? call.start_timestamp : undefined;
    const endMs = call.end_timestamp ? call.end_timestamp : undefined;
    const durationSec = call.duration_ms ? Math.round(call.duration_ms / 1000) : undefined;

    const { created } = await callLogService.writeCallLogForBusiness(
      businessId,
      {
        callId,
        businessId,
        agentId,
        callerPhone,
        rawPhone: callerPhone,
        startedAt: startMs ? new Date(startMs) : undefined,
        endedAt: endMs ? new Date(endMs) : undefined,
        durationSeconds: durationSec,
        disposition: mapDisposition(call.disconnection_reason),
        rawTranscript: call.transcript || undefined,
      },
      ctx
    );

    if (!created) {
      // Duplicate webhook — skip pipeline
      logger.info("Duplicate webhook, pipeline skipped", {
        ...logCtx(ctx),
        action: "post_call_pipeline",
        status: "duplicate_skipped",
        duration_ms: Date.now() - startTime,
      });
      res.status(200).json({ status: "duplicate", call_id: callId });
      return;
    }

    // ─── Step 2: Update caller memory ────────────────────
    if (callerPhone && callerPhone !== "unknown") {
      try {
        await memoryService.updateMemoryAfterCall(
          businessId,
          callerPhone,
          { lastCallId: callId, lastCallAt: new Date() },
          ctx
        );
      } catch (error) {
        logger.error("Post-call memory update failed", {
          ...logCtx(ctx),
          action: "post_call_memory",
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue — memory failure doesn't stop pipeline
      }
    }

    // ─── Step 3: Write basic CRM note ────────────────────
    let crmNoteId: string | undefined;
    if (callerPhone && callerPhone !== "unknown") {
      try {
        const { personId } = await crmService.upsertContactForBusiness(
          businessId, config, callerPhone, undefined, ctx
        );

        const disposition = mapDisposition(call.disconnection_reason);
        const noteTitle = `Arama — ${new Date().toISOString().split("T")[0]}`;
        const noteBody = [
          `**Durum:** ${disposition}`,
          `**Telefon:** ${callerPhone}`,
          `**Süre:** ${durationSec ? `${durationSec} saniye` : "bilinmiyor"}`,
          `**Call ID:** ${callId}`,
          `**Tarih:** ${new Date().toISOString()}`,
        ].join("\n\n");

        const noteResult = await crmService.writeCallNoteForBusiness(
          businessId, config, personId, noteTitle, noteBody, ctx
        );
        crmNoteId = noteResult.noteId;

        await callLogService.updateCallLogAfterCrm(callId, "success", crmNoteId, ctx);
      } catch (error) {
        logger.error("Post-call CRM write failed", {
          ...logCtx(ctx),
          action: "post_call_crm",
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          await callLogService.updateCallLogAfterCrm(callId, "failed", undefined, ctx);
        } catch { /* already logging */ }
        // Continue — CRM failure doesn't stop pipeline
      }
    }

    // ─── Step 4: Opus async (placeholder — Step 10) ──────
    logger.info("Opus processing skipped (not yet implemented)", {
      ...logCtx(ctx),
      action: "post_call_opus",
      status: "skipped",
    });
    // post_processing_status stays 'pending' by default — will be set to 'completed' by Opus in Step 10

    const durationMs = Date.now() - startTime;
    logger.info("Post-call pipeline completed", {
      ...logCtx(ctx),
      action: "post_call_pipeline",
      status: "ok",
      duration_ms: durationMs,
      crm_note_id: crmNoteId || null,
    });

    res.status(200).json({ status: "ok", call_id: callId });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error("Post-call pipeline failed", {
      call_id: callId,
      action: "post_call_pipeline",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      duration_ms: durationMs,
    });
    // Still return 200 — webhook should not retry on our processing errors
    res.status(200).json({ status: "error", call_id: callId });
  }
});

function logCtx(ctx: { callId: string; businessId: string }) {
  return { call_id: ctx.callId, business_id: ctx.businessId };
}

export default router;
