import * as businessRepo from "../repositories/business";
import { loadBusinessConfig } from "../config/loader";
import { BusinessNotFoundError } from "../lib/errors";
import { logger } from "../lib/logger";
import type { ResolvedBusinessConfig } from "../types";

/**
 * Business resolver pipeline: agent_id → metadata → telephony → fallback
 *
 * Retell sends agent_id with every function call.
 * Resolver finds the business by retell_agent_id, validates it's active,
 * and returns the full config (business + integrations).
 *
 * NEVER assumes a default business — throws if not found.
 */
export async function resolveBusiness(
  agentId: string,
  callId?: string
): Promise<ResolvedBusinessConfig> {
  const startTime = Date.now();

  // Step 1: Find business by agent_id (primary lookup)
  const business = await businessRepo.findByAgentId(agentId);

  if (!business) {
    logger.error("Business not found for agent_id", {
      call_id: callId,
      action: "resolve_business",
      status: "not_found",
      agent_id: agentId,
      duration_ms: Date.now() - startTime,
    });
    throw new BusinessNotFoundError(`agent_id:${agentId}`);
  }

  // Step 2: Check if business is active
  if (!business.isActive) {
    logger.warn("Resolved business is inactive", {
      call_id: callId,
      business_id: business.id,
      action: "resolve_business",
      status: "inactive",
      agent_id: agentId,
      duration_ms: Date.now() - startTime,
    });
    throw new BusinessNotFoundError(`agent_id:${agentId} (inactive)`);
  }

  // Step 3: Load full config (business + enabled integrations)
  const config = await loadBusinessConfig(business.id);

  logger.info("Business resolved", {
    call_id: callId,
    business_id: business.id,
    action: "resolve_business",
    status: "ok",
    agent_id: agentId,
    duration_ms: Date.now() - startTime,
  });

  return config;
}

/**
 * Fallback resolver: find business by phone number.
 * Used when agent_id lookup fails (telephony-based resolution).
 */
export async function resolveBusinessByPhone(
  phoneNumber: string,
  callId?: string
): Promise<ResolvedBusinessConfig> {
  const startTime = Date.now();

  const business = await businessRepo.findByPhoneNumber(phoneNumber);

  if (!business) {
    logger.error("Business not found for phone number", {
      call_id: callId,
      action: "resolve_business_by_phone",
      status: "not_found",
      duration_ms: Date.now() - startTime,
    });
    throw new BusinessNotFoundError(`phone:${phoneNumber}`);
  }

  if (!business.isActive) {
    logger.warn("Resolved business is inactive (phone lookup)", {
      call_id: callId,
      business_id: business.id,
      action: "resolve_business_by_phone",
      status: "inactive",
      duration_ms: Date.now() - startTime,
    });
    throw new BusinessNotFoundError(`phone:${phoneNumber} (inactive)`);
  }

  const config = await loadBusinessConfig(business.id);

  logger.info("Business resolved by phone", {
    call_id: callId,
    business_id: business.id,
    action: "resolve_business_by_phone",
    status: "ok",
    duration_ms: Date.now() - startTime,
  });

  return config;
}
