# AI Receptionist Platform — CLAUDE.md

Multi-tenant voice AI receptionist platform. One backend serves multiple businesses, each with its own agent, phone number, KB, calendar, and CRM. Agent operates 24/7 with identical behavior at all times — no after-hours mode.

## Tech Stack
- Node.js + TypeScript
- PostgreSQL + Prisma
- Retell AI (voice, conversation flow, KB, platform call controls)
- Cal.com (scheduling)
- GoHighLevel (CRM)
- Railway (hosting, single service, auto-deploy on main)
- Vitest (testing)
- Anthropic Opus (selective reasoning, post-call only by default)

## Architecture Rules
- One shared backend, one public Retell entrypoint, internal routing by function name + business context
- Business resolver pipeline: agent_id → metadata → telephony → fallback
- Shared PostgreSQL with business_id scoping (app-layer isolation, RLS-ready schema)
- Prisma for all migrations. Never raw SQL on production schema outside Prisma.
- Retell normal agents (NOT Custom LLM WebSocket)
- Retell handles conversation flow, KB queries, and platform-level call controls natively. All state-changing operations (scheduling, CRM, memory) go through backend custom functions. NO Retell built-in Cal.com tools.
- Two-table config pattern: `businesses` (core) + `integration_configs` (per-integration, config_json)

## Backend Functions (9 total)
1. check_availability  2. create_booking  3. cancel_booking
4. reschedule_booking (create new first, then cancel old)
5. take_message (type: message | callback | urgent)
6. get_caller_memory  7. get_business_hours  8. get_emergency_info
9. lookup_bookings (required before cancel/reschedule, max 3 results)
All receive call_id + agent_id from Retell context.
Backend safety net: cancel/reschedule rejected if no prior lookup for this call_id.
Booking ownership: verify bookingId belongs to businessId + callerPhone before mutations.

## Multi-Tenant Safety — CRITICAL
- NEVER assume a default business
- NEVER allow cross-business data leakage
- Every action: resolve business → load config → load integrations → execute in context → log
- All tables with tenant data MUST have business_id
- All repository functions MUST accept businessId as explicit parameter

## Coding Conventions
- Explicit business-scoped function signatures: `createBookingForBusiness(businessId, callerPhone, slot, eventTypeId)`
- Thin route handlers, fat services
- Isolate third-party API code in dedicated integration modules
- Config-driven behavior, not hardcoded business logic
- Readable code over clever abstractions
- Request context pattern: create `{ callId, businessId, functionName, startTime, callerPhone }` at entry of every function handler, pass through all service calls
- Structured JSON logs with call_id, business_id, action, duration_ms, status on every function call

## Project Structure
```
src/
  server.ts              # Express app + health check
  routes/
    retell.ts            # Single Retell function entrypoint
  middleware/
    auth.ts              # Webhook signature verification
  resolver/
    businessResolver.ts  # agent_id → business config pipeline
  services/
    booking.ts           # Cal.com booking logic
    crm.ts               # GHL contact/note logic
    memory.ts            # Caller memory read/write
    opus.ts              # Post-call processing
    callLog.ts           # Call logging + usage tracking
  integrations/
    retell.ts            # Retell API client
    calcom.ts            # Cal.com API client
    ghl.ts               # GHL API client
    anthropic.ts         # Opus API client
  config/
    validator.ts         # Business config validation
    loader.ts            # Load business config from DB
  repositories/
    business.ts          # Business CRUD (always business_id scoped)
    callLog.ts           # Call log CRUD
    memory.ts            # Memory CRUD (business_id + phone scoped)
  types/
    index.ts             # Shared TypeScript types
  lib/
    prisma.ts            # Singleton Prisma client (NEVER instantiate per request)
    logger.ts            # Structured JSON logger with call_id correlation
    errors.ts            # App-specific error types
    validation.ts        # Zod schemas for webhook payloads
    requestContext.ts    # Request context factory
prisma/
  schema.prisma
```

## Error Handling
- Booking (Cal.com create): NO retry — risk of double booking
- Booking conflict (Cal.com 409): catch, tell caller slot taken, re-query availability
- CRM writes (GHL): 1 retry on failure, then log and continue
- Opus in-call: timeout → fallback message, no retry
- Opus post-call: async, 1 retry. Never blocks CRM writes.
- All errors logged with call_id, business_id, function name, duration_ms, status

## Post-Call Pipeline
Trigger: Retell call.completed webhook → async processing
1. Write call log (disposition + last_step) → 2. Write/update caller memory → 3. Write basic CRM note → 4. Opus async (summary + enriched note + orphan check) → 5. Update call log + CRM
Memory and CRM are written before Opus. Opus never blocks. If Opus fails: keep basic CRM note, log failure, continue.

## Testing
- Vitest for all tests
- Must test: business resolver, multi-tenant isolation, service layer, config validation
- Mock external APIs (Retell, Cal.com, GHL) in tests
- Never call real external APIs in automated tests

## Commands
```bash
npm run dev          # Local development
npm run build        # TypeScript compile
npm run test         # Vitest
npm run migrate      # prisma migrate dev
npm run migrate:prod # prisma migrate deploy
npm run validate     # Run config validation
npm run seed         # Run onboarding seed script
```

## Key Decisions
- No KVKK/GDPR implementation in V1
- No billing in V1 (free pilot, usage tracked)
- No CRM pipeline in V1 (contact + notes only)
- No staging env in V1 (test agents for pre-deploy)
- No spam filtering in V1
- No formal call state machine in V1 (disposition + last_step sufficient)
- No auto data retention/deletion in V1
- No after-hours mode (agent is 24/7, availability driven by Cal.com data)
- One language per agent per business
- Cal.com handles booking conflicts (no backend slot locking)
- Post-call Opus triggered by Retell webhook, never blocks CRM
- Manual Retell agent creation V1 (standard template, API-driven V2)
- Multiple event types per business (1:N Cal.com)
- No AI disclaimer in greeting (receptionist presents as human)
- 9 backend functions (schedule_followup merged into take_message with type param)
- Prisma singleton, Zod validation, SIGTERM handling, UTC storage
- operating_hours field is informational only (for "what are your hours?" answers)
- Retell outage: developer monitors status page, contacts businesses manually
- Reschedule = create new first, then cancel old (preserves original on failure)
- Webhook idempotency via INSERT ON CONFLICT (call_id) DO NOTHING (race-free)
- CRM note dedup via ghl_note_id stored in call_logs
- Opus memory update guarded by last_call_id match (prevents stale overwrite)
- Urgent escalation V1: soft promise only, no real-time notification to notify_contact
- Booking ownership verified by businessId + callerPhone match before cancel/reschedule

## Environment Variables
RETELL_API_KEY, CALCOM_API_KEY, GHL_API_KEY, ANTHROPIC_API_KEY,
DATABASE_URL, WEBHOOK_SECRET, PORT, NODE_ENV, LOG_LEVEL

## Detailed References
- docs/project-instruction.md — full V1 spec (source of truth)
- docs/schemas.md — all table schemas and config JSON formats
- docs/decisions.md — decision log with rationale
- docs/conversation-flow.md — intents, flows, edge cases
- docs/integrations.md — Cal.com, GHL, Retell, Opus details
- docs/error-handling.md — retry, timeout, degradation rules
- docs/onboarding.md — business onboarding steps
- docs/v2-research.md — future paths (do not build)

## When Compacting
Preserve: multi-tenant safety rules, current implementation phase,
list of modified files, test commands, active build priority step,
any unresolved decisions or blockers from this session.

## Current Phase
Step 0: Pre-build validation (Retell capability spike + Cal.com API spike + GHL API spike)
