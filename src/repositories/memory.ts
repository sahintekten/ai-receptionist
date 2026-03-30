import { prisma } from "../lib/prisma";
import type { CallerMemory } from "@prisma/client";

export async function getByBusinessAndPhone(
  businessId: string,
  callerPhone: string
): Promise<CallerMemory | null> {
  return prisma.callerMemory.findUnique({
    where: {
      businessId_callerPhone: { businessId, callerPhone },
    },
  });
}

export async function upsertMemory(
  businessId: string,
  callerPhone: string,
  data: {
    rawPhone?: string;
    callerName?: string;
    lastCallId?: string;
    lastCallAt?: Date;
    recentAppointmentStatus?: string;
    recentMessageSummary?: string;
  }
): Promise<CallerMemory> {
  return prisma.callerMemory.upsert({
    where: {
      businessId_callerPhone: { businessId, callerPhone },
    },
    create: {
      businessId,
      callerPhone,
      ...data,
    },
    update: {
      ...data,
    },
  });
}
