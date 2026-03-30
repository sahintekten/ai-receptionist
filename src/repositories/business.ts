import { prisma } from "../lib/prisma";
import type { Business, IntegrationConfig } from "@prisma/client";

export async function findByAgentId(agentId: string): Promise<Business | null> {
  return prisma.business.findFirst({
    where: { retellAgentId: agentId },
  });
}

export async function findByPhoneNumber(phoneNumber: string): Promise<Business | null> {
  return prisma.business.findFirst({
    where: { phoneNumber },
  });
}

export async function getIntegrationConfigs(
  businessId: string
): Promise<IntegrationConfig[]> {
  return prisma.integrationConfig.findMany({
    where: { businessId, isEnabled: true },
  });
}
