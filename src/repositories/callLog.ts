import { prisma } from "../lib/prisma";
import type { CallLog, Prisma } from "@prisma/client";

export async function createCallLog(
  data: Prisma.CallLogCreateInput
): Promise<{ callLog: CallLog; created: boolean }> {
  // Webhook idempotency: INSERT ON CONFLICT call_id DO NOTHING
  // Prisma doesn't have native "DO NOTHING", so we use upsert with no-op update
  const existing = await prisma.callLog.findUnique({
    where: { callId: data.callId },
  });

  if (existing) {
    return { callLog: existing, created: false };
  }

  const callLog = await prisma.callLog.create({ data });
  return { callLog, created: true };
}

export async function updateCallLog(
  callId: string,
  updates: Prisma.CallLogUpdateInput
): Promise<CallLog> {
  return prisma.callLog.update({
    where: { callId },
    data: updates,
  });
}

export async function getByCallId(callId: string): Promise<CallLog | null> {
  return prisma.callLog.findUnique({
    where: { callId },
  });
}

export async function getByBusinessId(
  businessId: string,
  options?: {
    limit?: number;
    offset?: number;
    startDate?: Date;
    endDate?: Date;
  }
): Promise<CallLog[]> {
  const where: Prisma.CallLogWhereInput = { businessId };

  if (options?.startDate || options?.endDate) {
    where.createdAt = {};
    if (options.startDate) where.createdAt.gte = options.startDate;
    if (options.endDate) where.createdAt.lte = options.endDate;
  }

  return prisma.callLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: options?.limit || 50,
    skip: options?.offset || 0,
  });
}
