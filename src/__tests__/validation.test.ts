import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("../lib/prisma", () => ({
  prisma: {
    business: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma";
import { validateAllBusinesses } from "../config/validator";

function makeBusiness(overrides: Record<string, unknown> = {}) {
  return {
    id: "biz-1",
    name: "Test Clinic",
    language: "tr",
    timezone: "Europe/Istanbul",
    retellAgentId: "agent-abc",
    phoneNumber: "+905551234567",
    kbReference: "kb-123",
    greetingText: "Merhaba",
    closingText: "İyi günler",
    fillerSpeech: "Bir saniye...",
    fallbackMessage: "Yardımcı olamıyorum",
    degradationMode: "message",
    languageMismatchAction: "message_take",
    urgentEscalationConfig: {},
    enabledIntents: [],
    operatingHours: {
      monday: [{ open: "09:00", close: "18:00" }],
      sunday: [],
    },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    integrationConfigs: [
      {
        id: "ic-1",
        businessId: "biz-1",
        integrationType: "calcom",
        configJson: { event_types: [{ id: 123, name: "Test", duration_minutes: 30, service_type: "test" }] },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "ic-2",
        businessId: "biz-1",
        integrationType: "twenty",
        configJson: { api_key: "test-key" },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    ...overrides,
  };
}

describe("Config Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.business.update).mockResolvedValue({} as any);
  });

  it("valid config passes validation", async () => {
    vi.mocked(prisma.business.findMany).mockResolvedValue([makeBusiness()] as any);

    const result = await validateAllBusinesses();

    expect(result.valid).toBe(1);
    expect(result.invalid).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("missing agent_id fails validation", async () => {
    vi.mocked(prisma.business.findMany).mockResolvedValue([
      makeBusiness({ retellAgentId: "" }),
    ] as any);

    const result = await validateAllBusinesses();

    expect(result.invalid).toBe(1);
    expect(result.errors[0].errors).toContain("retell_agent_id is missing");
  });

  it("missing phone_number fails validation", async () => {
    vi.mocked(prisma.business.findMany).mockResolvedValue([
      makeBusiness({ phoneNumber: "" }),
    ] as any);

    const result = await validateAllBusinesses();

    expect(result.invalid).toBe(1);
    expect(result.errors[0].errors).toContain("phone_number is missing");
  });

  it("missing Cal.com event types fails validation", async () => {
    const biz = makeBusiness();
    biz.integrationConfigs = biz.integrationConfigs.filter(
      (ic: any) => ic.integrationType !== "calcom"
    );

    vi.mocked(prisma.business.findMany).mockResolvedValue([biz] as any);

    const result = await validateAllBusinesses();

    expect(result.invalid).toBe(1);
    expect(result.errors[0].errors).toContain("Cal.com integration config missing or disabled");
  });

  it("missing Twenty api_key fails validation", async () => {
    const biz = makeBusiness();
    const twentyConfig = biz.integrationConfigs.find((ic: any) => ic.integrationType === "twenty");
    if (twentyConfig) (twentyConfig as any).configJson = {};

    vi.mocked(prisma.business.findMany).mockResolvedValue([biz] as any);

    const result = await validateAllBusinesses();

    expect(result.invalid).toBe(1);
    expect(result.errors[0].errors).toContain("Twenty CRM api_key is missing in config");
  });

  it("duplicate agent_id across businesses fails validation", async () => {
    const biz1 = makeBusiness({ id: "biz-1", retellAgentId: "agent-same" });
    const biz2 = makeBusiness({ id: "biz-2", name: "Clinic 2", retellAgentId: "agent-same", phoneNumber: "+905559999999" });

    vi.mocked(prisma.business.findMany).mockResolvedValue([biz1, biz2] as any);

    const result = await validateAllBusinesses();

    // One of the two should fail with duplicate error
    const allErrors = result.errors.flatMap((e) => e.errors);
    const hasDuplicateError = allErrors.some((e) => e.includes("duplicate"));
    expect(hasDuplicateError).toBe(true);
  });
});
