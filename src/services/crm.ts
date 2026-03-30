import * as twenty from "../integrations/twenty";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import type { ResolvedBusinessConfig, TwentyConfig } from "../types";
import type { RequestContext } from "../lib/requestContext";

function getTwentyConfig(config: ResolvedBusinessConfig): TwentyConfig {
  const integration = config.integrations.find(
    (i) => i.type === "twenty" && i.isEnabled
  );
  if (!integration) {
    throw new AppError("Twenty CRM not configured for this business", "CRM_NOT_CONFIGURED", 500);
  }
  return integration.config as TwentyConfig;
}

function logContext(ctx: RequestContext) {
  return { call_id: ctx.callId, business_id: ctx.businessId };
}

// ─── Upsert Contact ─────────────────────────────────────

export async function upsertContactForBusiness(
  businessId: string,
  config: ResolvedBusinessConfig,
  callerPhone: string,
  callerName: string | undefined,
  ctx: RequestContext
): Promise<{ personId: string; created: boolean }> {
  const twentyConfig = getTwentyConfig(config);
  const startTime = Date.now();

  logger.info("Upserting CRM contact", {
    ...logContext(ctx),
    action: "crm_upsert_contact",
    status: "processing",
  });

  const firstName = callerName || "Arayan";
  const { person, created } = await twenty.upsertPerson(
    twentyConfig.api_key,
    callerPhone,
    firstName,
    "",
    "+90",
    logContext(ctx)
  );

  logger.info("CRM contact upserted", {
    ...logContext(ctx),
    action: "crm_upsert_contact",
    status: "ok",
    duration_ms: Date.now() - startTime,
    person_id: person.id,
    created,
  });

  return { personId: person.id, created };
}

// ─── Write Call Note ─────────────────────────────────────

export async function writeCallNoteForBusiness(
  businessId: string,
  config: ResolvedBusinessConfig,
  personId: string,
  noteTitle: string,
  noteBody: string,
  ctx: RequestContext
): Promise<{ noteId: string }> {
  const twentyConfig = getTwentyConfig(config);
  const startTime = Date.now();

  logger.info("Writing CRM note", {
    ...logContext(ctx),
    action: "crm_write_note",
    status: "processing",
    person_id: personId,
  });

  // Create note
  const note = await twenty.createNote(
    twentyConfig.api_key,
    noteTitle,
    noteBody,
    logContext(ctx)
  );

  // Link note to person
  await twenty.linkNoteToPersonTarget(
    twentyConfig.api_key,
    note.id,
    personId,
    logContext(ctx)
  );

  logger.info("CRM note written and linked", {
    ...logContext(ctx),
    action: "crm_write_note",
    status: "ok",
    duration_ms: Date.now() - startTime,
    note_id: note.id,
    person_id: personId,
  });

  return { noteId: note.id };
}

// ─── Update Call Note ────────────────────────────────────

export async function updateCallNoteForBusiness(
  businessId: string,
  config: ResolvedBusinessConfig,
  noteId: string,
  noteTitle: string | undefined,
  noteBody: string | undefined,
  ctx: RequestContext
): Promise<void> {
  const twentyConfig = getTwentyConfig(config);
  const startTime = Date.now();

  logger.info("Updating CRM note", {
    ...logContext(ctx),
    action: "crm_update_note",
    status: "processing",
    note_id: noteId,
  });

  await twenty.updateNote(
    twentyConfig.api_key,
    noteId,
    noteTitle,
    noteBody,
    logContext(ctx)
  );

  logger.info("CRM note updated", {
    ...logContext(ctx),
    action: "crm_update_note",
    status: "ok",
    duration_ms: Date.now() - startTime,
    note_id: noteId,
  });
}
