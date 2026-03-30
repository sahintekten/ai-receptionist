import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../lib/errors";

// Mock Twenty integration
vi.mock("../integrations/twenty", () => ({
  upsertPerson: vi.fn(),
  createNote: vi.fn(),
  linkNoteToPersonTarget: vi.fn(),
  updateNote: vi.fn(),
}));

import * as twenty from "../integrations/twenty";
import * as crmService from "../services/crm";
import type { ResolvedBusinessConfig } from "../types";
import type { RequestContext } from "../lib/requestContext";

const mockCtx: RequestContext = {
  callId: "call-1",
  businessId: "biz-1",
  functionName: "take_message",
  startTime: Date.now(),
  callerPhone: "+905551234567",
};

function makeConfig(hasTwenty: boolean): ResolvedBusinessConfig {
  return {
    business: { id: "biz-1", name: "Test" } as any,
    integrations: hasTwenty
      ? [{ id: "int-1", type: "twenty" as const, config: { api_key: "test-key" }, isEnabled: true }]
      : [],
  };
}

describe("CRM Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error when Twenty config not found", async () => {
    const config = makeConfig(false);

    await expect(
      crmService.upsertContactForBusiness("biz-1", config, "+905551234567", "Ali", mockCtx)
    ).rejects.toThrow(AppError);
  });

  it("upsertContact returns personId on success", async () => {
    vi.mocked(twenty.upsertPerson).mockResolvedValue({
      person: { id: "person-123", name: { firstName: "Ali", lastName: "" } } as any,
      created: true,
    });

    const config = makeConfig(true);
    const result = await crmService.upsertContactForBusiness(
      "biz-1", config, "+905551234567", "Ali", mockCtx
    );

    expect(result.personId).toBe("person-123");
    expect(result.created).toBe(true);
  });

  it("writeCallNote returns noteId on success", async () => {
    vi.mocked(twenty.createNote).mockResolvedValue({
      id: "note-456",
      title: "Test",
      bodyV2: { blocknote: null, markdown: "test" },
      createdAt: "",
      updatedAt: "",
    });
    vi.mocked(twenty.linkNoteToPersonTarget).mockResolvedValue({
      id: "target-1",
      noteId: "note-456",
      targetPersonId: "person-123",
    });

    const config = makeConfig(true);
    const result = await crmService.writeCallNoteForBusiness(
      "biz-1", config, "person-123", "Title", "Body", mockCtx
    );

    expect(result.noteId).toBe("note-456");
    expect(twenty.linkNoteToPersonTarget).toHaveBeenCalledWith(
      "test-key", "note-456", "person-123", expect.any(Object)
    );
  });

  it("CRM failure is thrown (caller handles graceful degradation)", async () => {
    vi.mocked(twenty.upsertPerson).mockRejectedValue(new Error("Twenty API down"));

    const config = makeConfig(true);

    await expect(
      crmService.upsertContactForBusiness("biz-1", config, "+905551234567", "Ali", mockCtx)
    ).rejects.toThrow("Twenty API down");
  });
});
