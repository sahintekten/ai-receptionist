import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("../lib/prisma", () => ({
  prisma: {
    callerMemory: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    callLog: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma";
import * as memoryRepo from "../repositories/memory";
import * as callLogRepo from "../repositories/callLog";

describe("Multi-Tenant Isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Memory isolation", () => {
    it("queries memory scoped by businessId + callerPhone", async () => {
      vi.mocked(prisma.callerMemory.findUnique).mockResolvedValue(null);

      await memoryRepo.getByBusinessAndPhone("biz-A", "+905551111111");

      expect(prisma.callerMemory.findUnique).toHaveBeenCalledWith({
        where: {
          businessId_callerPhone: {
            businessId: "biz-A",
            callerPhone: "+905551111111",
          },
        },
      });
    });

    it("upsert memory is scoped by businessId + callerPhone", async () => {
      vi.mocked(prisma.callerMemory.upsert).mockResolvedValue({} as any);

      await memoryRepo.upsertMemory("biz-A", "+905551111111", {
        callerName: "Ali",
        lastCallId: "call-1",
      });

      const call = vi.mocked(prisma.callerMemory.upsert).mock.calls[0][0];
      expect(call.where.businessId_callerPhone!.businessId).toBe("biz-A");
      expect(call.where.businessId_callerPhone!.callerPhone).toBe("+905551111111");
      expect(call.create.businessId).toBe("biz-A");
    });

    it("Business A memory query does not leak to Business B", async () => {
      vi.mocked(prisma.callerMemory.findUnique).mockResolvedValue(null);

      await memoryRepo.getByBusinessAndPhone("biz-A", "+905551111111");
      await memoryRepo.getByBusinessAndPhone("biz-B", "+905551111111");

      const calls = vi.mocked(prisma.callerMemory.findUnique).mock.calls;
      expect(calls[0][0].where.businessId_callerPhone!.businessId).toBe("biz-A");
      expect(calls[1][0].where.businessId_callerPhone!.businessId).toBe("biz-B");
    });
  });

  describe("Call log isolation", () => {
    it("queries call logs scoped by businessId", async () => {
      vi.mocked(prisma.callLog.findMany).mockResolvedValue([]);

      await callLogRepo.getByBusinessId("biz-A", { limit: 10 });

      expect(prisma.callLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: "biz-A" },
        })
      );
    });

    it("call log create includes businessId via connect", async () => {
      vi.mocked(prisma.callLog.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.callLog.create).mockResolvedValue({ callId: "call-1" } as any);

      await callLogRepo.createCallLog({
        callId: "call-1",
        business: { connect: { id: "biz-A" } },
        agentId: "agent-1",
        callerPhone: "+905551111111",
      });

      const createCall = vi.mocked(prisma.callLog.create).mock.calls[0][0];
      expect(createCall.data.business).toEqual({ connect: { id: "biz-A" } });
    });
  });
});
