# Spec vs Implementation Divergences

This document tracks all differences between the original specification (docs/project-instruction.md, CLAUDE.md initial, schemas.md, decisions.md, integrations.md) and the actual V1 implementation.

## Retell Agent Architecture

| Area | Original Spec | Implementation | Reason |
|------|--------------|----------------|--------|
| Agent type | "Normal agents" | Conversation Flow agents | Node-based prompt/tool isolation, structural function ordering, less hallucination. Decided in Step 0 pre-build validation. |
| Agent creation | Manual (V1), API-driven (V2) | API-driven (V1) via setup scripts | Pulled from V2 to V1. `scripts/setup-retell.mjs` + `create-agent.mjs` automate KB, flow, and agent creation. |
| Retell tool count | 9 backend functions = 9 tools | 8 Retell tools, 9 backend functions | `reschedule_booking` not a separate tool — rescheduling node uses `create_booking` + `cancel_booking` combo. Backend function exists but isn't exposed as Retell tool. |
| Voice | Not specified | Cartesia Cleo | $0.015/min (1/3 of ElevenLabs), ~40-90ms latency, Sonic 3 Turkish support. Decided in Step 0. |

## CRM Integration

| Area | Original Spec | Implementation | Reason |
|------|--------------|----------------|--------|
| CRM provider | GoHighLevel (GHL) | Twenty CRM | Lower cost ($12/seat vs $97/mo), simpler REST API, workspace-level isolation. Decided before V1 implementation. Original GHL spec archived in `docs/archive/ghl-original-spec.md`. |
| CRM note ID field | `ghl_note_id` in call_logs | `crm_note_id` in call_logs | Renamed for CRM-agnostic naming. Migration applied. |
| Note body field | `body` (assumed) | `bodyV2` (RICH_TEXT with markdown) | Twenty uses `bodyV2` not `body`. Discovered during API spike. Accepts `{"markdown": "..."}` input, returns both blocknote JSON and markdown. |
| Note-person linking | Direct (assumed in-object) | Separate `noteTargets` endpoint | Two-step: create note → create noteTarget with `noteId` + `targetPersonId`. Discovered during API spike. |
| Phone search | API filter | Client-side filter | Twenty REST API silently ignores composite field filters (`phones.primaryPhoneNumber`). Workaround: fetch all people, match client-side. Acceptable at pilot volume (<100 contacts). |
| CRM topology | One agency, one location per business | One workspace per business | Twenty uses workspace isolation instead of GHL's agency/location model. |

## Environment & Auth

| Area | Original Spec | Implementation | Reason |
|------|--------------|----------------|--------|
| `WEBHOOK_SECRET` | Listed as env variable | Removed | Retell SDK `Retell.verify(body, apiKey, signature)` uses `RETELL_API_KEY` directly. Separate shared secret unnecessary. |
| `GHL_API_KEY` | Listed as env variable | Removed, replaced by `TWENTY_API_KEY` | GHL replaced by Twenty. Twenty API key stored per-business in `integration_configs`, env var for local dev only. |

## Request Handling

| Area | Original Spec | Implementation | Reason |
|------|--------------|----------------|--------|
| Args format | camelCase only | Both camelCase and snake_case | Retell Conversation Flow sends snake_case args (`caller_phone`, `service_type`, `booking_id`). All schemas accept both formats with normalization. |
| Phone resolution | `call.from_number` only | `call.from_number` → `args.callerPhone` fallback | Test calls via Retell simulation don't have telco caller ID. Agent collects phone verbally and sends in args. |
| Phone normalization | E.164 assumed | Turkish normalization added | `05xx` → `+905xx`, 10-digit `5xx` → `+905xx`, strip spaces/dashes. |

## Cal.com Integration

| Area | Original Spec | Implementation | Reason |
|------|--------------|----------------|--------|
| Booking location | `location: { type: "phone", value: "..." }` | No location field, phone in metadata | Cal.com v2 API rejects `"phone"` as location type. Phone passed via `metadata.phone` instead. |
| Slot format | Not specified | Must match availability response exactly: `T15:00:00.000+03:00` | Cal.com requires millisecond precision (`.000`) and timezone offset in the exact format returned by `/slots` endpoint. |
| Event type resolution | `eventTypeId` required | Resolved from `service_type` / `doctor_name` | Retell agent sends service type or doctor name, not Cal.com event type ID. Backend matches against `integration_configs.calcom.event_types`. |
| API version headers | Not specified | Required: `cal-api-version: 2024-09-04` (slots), `2024-08-13` (bookings) | Different API version headers per endpoint group. Missing header = error. |

## Retell Simulation

| Area | Original Spec | Implementation | Reason |
|------|--------------|----------------|--------|
| `agent_id` in test calls | Required (spec assumes real calls) | Optional in simulation — may be empty | Retell simulation doesn't always populate `agent_id`. Business resolver requires it. Fixed by ensuring test agent has proper agent_id. |
