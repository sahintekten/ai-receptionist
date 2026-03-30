import { IntegrationError } from "../lib/errors";
import { logger } from "../lib/logger";

const TWENTY_BASE_URL = "https://api.twenty.com";
const TIMEOUT_MS = 10_000;

// ─── Types ───────────────────────────────────────────────

export interface TwentyPerson {
  id: string;
  name: { firstName: string; lastName: string };
  phones: {
    primaryPhoneNumber: string;
    primaryPhoneCallingCode: string;
    primaryPhoneCountryCode: string;
    additionalPhones: unknown[];
  };
  emails: { primaryEmail: string; additionalEmails: unknown[] };
  createdAt: string;
  updatedAt: string;
}

export interface TwentyNote {
  id: string;
  title: string;
  bodyV2: { blocknote: string | null; markdown: string };
  createdAt: string;
  updatedAt: string;
}

export interface TwentyNoteTarget {
  id: string;
  noteId: string;
  targetPersonId: string;
}

// ─── HTTP Client ─────────────────────────────────────────

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function twentyFetch<T>(
  apiKey: string,
  path: string,
  options: RequestInit,
  context?: { call_id?: string; business_id?: string; action?: string }
): Promise<T> {
  const url = `${TWENTY_BASE_URL}${path}`;
  const startTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...headers(apiKey), ...(options.headers as Record<string, string>) },
      signal: controller.signal,
    });

    const durationMs = Date.now() - startTime;
    const body = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      logger.error("Twenty API error", {
        call_id: context?.call_id,
        business_id: context?.business_id,
        action: context?.action,
        status: "error",
        duration_ms: durationMs,
        http_status: response.status,
        error: JSON.stringify(body),
      });
      throw new IntegrationError("Twenty", `API returned ${response.status}`, {
        httpStatus: response.status,
        body,
      });
    }

    logger.debug("Twenty API success", {
      call_id: context?.call_id,
      business_id: context?.business_id,
      action: context?.action,
      status: "ok",
      duration_ms: durationMs,
    });

    return body as T;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;

    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof Error && error.name === "AbortError";

    logger.error("Twenty API failure", {
      call_id: context?.call_id,
      business_id: context?.business_id,
      action: context?.action,
      status: isTimeout ? "timeout" : "error",
      duration_ms: durationMs,
      error: message,
    });

    throw new IntegrationError("Twenty", isTimeout ? "Request timed out" : message);
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  context?: { call_id?: string; business_id?: string; action?: string }
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn("Twenty retry attempt", {
      call_id: context?.call_id,
      business_id: context?.business_id,
      action: context?.action,
      status: "retrying",
    });
    return await fn();
  }
}

// ─── Public API ──────────────────────────────────────────

/**
 * Search for a person by phone number.
 * Twenty REST API doesn't support filtering on composite fields,
 * so we fetch all people and filter client-side.
 */
export async function searchPersonByPhone(
  apiKey: string,
  phone: string,
  context?: { call_id?: string; business_id?: string }
): Promise<TwentyPerson | null> {
  const ctx = { ...context, action: "twenty_search_person" };

  // Strip non-digits for comparison
  const normalizedPhone = phone.replace(/[^0-9]/g, "");

  // Fetch people in pages of 100 and match client-side
  let hasMore = true;
  let cursor: string | undefined;

  while (hasMore) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("starting_after", cursor);

    const result = await withRetry(
      () => twentyFetch<{
        data: { people: TwentyPerson[] };
        pageInfo: { endCursor: string; hasNextPage: boolean };
      }>(apiKey, `/rest/people?${params}`, { method: "GET" }, ctx),
      ctx
    );

    const people = result.data.people;
    for (const person of people) {
      const personPhone = person.phones.primaryPhoneNumber.replace(/[^0-9]/g, "");
      if (personPhone === normalizedPhone) {
        return person;
      }
      // Also check with calling code prefix
      const fullPhone = (person.phones.primaryPhoneCallingCode + person.phones.primaryPhoneNumber).replace(/[^0-9]/g, "");
      if (fullPhone === normalizedPhone) {
        return person;
      }
    }

    hasMore = result.pageInfo.hasNextPage;
    cursor = result.pageInfo.endCursor;
  }

  return null;
}

export async function createPerson(
  apiKey: string,
  firstName: string,
  lastName: string,
  phone: string,
  callingCode: string = "+90",
  context?: { call_id?: string; business_id?: string }
): Promise<TwentyPerson> {
  const ctx = { ...context, action: "twenty_create_person" };

  const result = await withRetry(
    () => twentyFetch<{ data: { createPerson: TwentyPerson } }>(
      apiKey,
      "/rest/people",
      {
        method: "POST",
        body: JSON.stringify({
          name: { firstName, lastName },
          phones: { primaryPhoneNumber: phone, primaryPhoneCallingCode: callingCode },
        }),
      },
      ctx
    ),
    ctx
  );

  return result.data.createPerson;
}

export async function updatePerson(
  apiKey: string,
  personId: string,
  updates: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    callingCode?: string;
  },
  context?: { call_id?: string; business_id?: string }
): Promise<TwentyPerson> {
  const ctx = { ...context, action: "twenty_update_person" };

  const body: Record<string, unknown> = {};
  if (updates.firstName !== undefined || updates.lastName !== undefined) {
    body.name = {
      ...(updates.firstName !== undefined && { firstName: updates.firstName }),
      ...(updates.lastName !== undefined && { lastName: updates.lastName }),
    };
  }
  if (updates.phone !== undefined) {
    body.phones = {
      primaryPhoneNumber: updates.phone,
      ...(updates.callingCode && { primaryPhoneCallingCode: updates.callingCode }),
    };
  }

  const result = await withRetry(
    () => twentyFetch<{ data: { updatePerson: TwentyPerson } }>(
      apiKey,
      `/rest/people/${personId}`,
      { method: "PATCH", body: JSON.stringify(body) },
      ctx
    ),
    ctx
  );

  return result.data.updatePerson;
}

export async function upsertPerson(
  apiKey: string,
  phone: string,
  firstName: string,
  lastName: string = "",
  callingCode: string = "+90",
  context?: { call_id?: string; business_id?: string }
): Promise<{ person: TwentyPerson; created: boolean }> {
  // Strip calling code from phone if present
  let localPhone = phone.replace(/[^0-9]/g, "");
  if (localPhone.startsWith("90") && localPhone.length > 10) {
    localPhone = localPhone.substring(2);
  }

  const existing = await searchPersonByPhone(apiKey, localPhone, context);

  if (existing) {
    // Update name if provided and different
    if (firstName && firstName !== existing.name.firstName) {
      const updated = await updatePerson(apiKey, existing.id, { firstName, lastName }, context);
      return { person: updated, created: false };
    }
    return { person: existing, created: false };
  }

  const person = await createPerson(apiKey, firstName, lastName, localPhone, callingCode, context);
  return { person, created: true };
}

export async function createNote(
  apiKey: string,
  title: string,
  markdownBody: string,
  context?: { call_id?: string; business_id?: string }
): Promise<TwentyNote> {
  const ctx = { ...context, action: "twenty_create_note" };

  const result = await withRetry(
    () => twentyFetch<{ data: { createNote: TwentyNote } }>(
      apiKey,
      "/rest/notes",
      {
        method: "POST",
        body: JSON.stringify({
          title,
          bodyV2: { markdown: markdownBody },
        }),
      },
      ctx
    ),
    ctx
  );

  return result.data.createNote;
}

export async function updateNote(
  apiKey: string,
  noteId: string,
  title?: string,
  markdownBody?: string,
  context?: { call_id?: string; business_id?: string }
): Promise<TwentyNote> {
  const ctx = { ...context, action: "twenty_update_note" };

  const body: Record<string, unknown> = {};
  if (title !== undefined) body.title = title;
  if (markdownBody !== undefined) body.bodyV2 = { markdown: markdownBody };

  const result = await withRetry(
    () => twentyFetch<{ data: { updateNote: TwentyNote } }>(
      apiKey,
      `/rest/notes/${noteId}`,
      { method: "PATCH", body: JSON.stringify(body) },
      ctx
    ),
    ctx
  );

  return result.data.updateNote;
}

export async function linkNoteToPersonTarget(
  apiKey: string,
  noteId: string,
  personId: string,
  context?: { call_id?: string; business_id?: string }
): Promise<TwentyNoteTarget> {
  const ctx = { ...context, action: "twenty_link_note_person" };

  const result = await withRetry(
    () => twentyFetch<{ data: { createNoteTarget: TwentyNoteTarget } }>(
      apiKey,
      "/rest/noteTargets",
      {
        method: "POST",
        body: JSON.stringify({ noteId, targetPersonId: personId }),
      },
      ctx
    ),
    ctx
  );

  return result.data.createNoteTarget;
}
