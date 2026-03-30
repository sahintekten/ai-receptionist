import { describe, it, expect, vi, beforeEach } from "vitest";
import { BusinessNotFoundError } from "../lib/errors";

// Mock Prisma
vi.mock("../lib/prisma", () => ({
  prisma: {
    business: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    integrationConfig: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma";
import { resolveBusiness } from "../resolver/businessResolver";

const mockBusiness = {
  id: "biz-1",
  name: "Test Clinic",
  language: "tr",
  timezone: "Europe/Istanbul",
  retellAgentId: "agent-abc",
  phoneNumber: "+905551234567",
  isActive: true,
  operatingHours: {},
  greetingText: "Merhaba",
  closingText: "İyi günler",
  fillerSpeech: "Bir saniye...",
  fallbackMessage: "Yardımcı olamıyorum",
  degradationMode: "message",
  languageMismatchAction: "message_take",
  urgentEscalationConfig: {},
  kbReference: "kb-123",
  enabledIntents: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Business Resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves business by known agent_id", async () => {
    vi.mocked(prisma.business.findFirst).mockResolvedValue(mockBusiness as any);
    vi.mocked(prisma.business.findUnique).mockResolvedValue(mockBusiness as any);
    vi.mocked(prisma.integrationConfig.findMany).mockResolvedValue([]);

    const result = await resolveBusiness("agent-abc", "call-1");

    expect(result.business.id).toBe("biz-1");
    expect(result.business.name).toBe("Test Clinic");
    expect(prisma.business.findFirst).toHaveBeenCalledWith({
      where: { retellAgentId: "agent-abc" },
    });
  });

  it("throws BusinessNotFoundError for unknown agent_id", async () => {
    vi.mocked(prisma.business.findFirst).mockResolvedValue(null);

    await expect(resolveBusiness("unknown-agent", "call-2"))
      .rejects.toThrow(BusinessNotFoundError);
  });

  it("throws BusinessNotFoundError for inactive business", async () => {
    vi.mocked(prisma.business.findFirst).mockResolvedValue({
      ...mockBusiness,
      isActive: false,
    } as any);

    await expect(resolveBusiness("agent-abc", "call-3"))
      .rejects.toThrow(BusinessNotFoundError);
  });
});
