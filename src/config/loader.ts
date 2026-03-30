import { prisma } from "../lib/prisma";
import * as businessRepo from "../repositories/business";
import { BusinessNotFoundError } from "../lib/errors";
import { logger } from "../lib/logger";
import type { ResolvedBusinessConfig } from "../types";
import type { IntegrationConfig } from "@prisma/client";

function toResolvedIntegration(config: IntegrationConfig) {
  return {
    id: config.id,
    type: config.integrationType,
    config: config.configJson as Record<string, unknown>,
    isEnabled: config.isEnabled,
  };
}

export async function loadBusinessConfig(
  businessId: string
): Promise<ResolvedBusinessConfig> {
  const [business, integrationConfigs] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId } }),
    businessRepo.getIntegrationConfigs(businessId),
  ]);

  if (!business) {
    throw new BusinessNotFoundError(businessId);
  }

  if (!business.isActive) {
    logger.warn("Business is deactivated", {
      business_id: businessId,
      action: "load_business_config",
      status: "inactive",
    });
    throw new BusinessNotFoundError(businessId);
  }

  return {
    business,
    integrations: integrationConfigs.map(toResolvedIntegration),
  };
}
