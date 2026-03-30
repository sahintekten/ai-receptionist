# AI Receptionist Platform — CLAUDE.md

Multi-tenant voice AI receptionist platform. One backend serves multiple businesses, each with its own agent, phone number, KB, calendar, and CRM. Agent operates 24/7 with identical behavior at all times — no after-hours mode.

## Tech Stack
- Node.js + TypeScript
- PostgreSQL + Prisma
- Retell AI (Conversation Flow agents, KB, platform call controls)
- Cal.com (scheduling)
- Twenty CRM (replaces GHL for V1, $12/seat/mo)
- Railway (hosting, single service, auto-deploy on main)
- Vitest (testing)
- Anthropic Opus (selective reasoning, post-call only by default)

## Architecture Rules
- One shared backend, one public Retell entrypoint, internal routing by function name + business context
- Business resolver pipeline: agent_id → metadata → telephony → fallback
- Shared PostgreSQL with business_id scoping (app-layer isolation, RLS-ready schema)
- Prisma for all migrations. Never raw SQL on production schema outside Prisma.
- Retell Conversation Flow agents (NOT Custom LLM WebSocket, NOT Single Prompt)
- Retell handles conversation flow, KB queries, and platform-level call controls natively. All state-changing operations (scheduling, CRM, memory) go through backend custom functions. NO Retell built-in Cal.com tools.
- Two-table config pattern: `businesses` (core) + `integration_configs` (per-integration, config_json)

## Backend Functions (9 total, 8 Retell tools)
1. check_availability  2. create_booking  3. cancel_booking
4. reschedule_booking (Retell tarafında ayrı tool yok — rescheduling node'unda create_booking + cancel_booking kombinasyonu. Backend'de reschedule_booking fonksiyonu mevcut ama Retell tool olarak expose edilmedi.)
5. take_message (type: message | callback | urgent)
6. get_caller_memory  7. get_business_hours  8. get_emergency_info
9. lookup_bookings (required before cancel/reschedule, max 3 results)
All receive call_id + agent_id from Retell context.
Backend safety net: cancel/reschedule rejected if no prior lookup for this call_id.
Booking ownership: verify bookingId belongs to businessId + callerPhone before mutations.
Phone resolution: telco caller ID → args.callerPhone fallback (test calls).
Args normalization: both camelCase and snake_case accepted from Retell.

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
  server.ts              # Express app + health check + config validation on startup
  routes/
    retell.ts            # Single Retell function entrypoint (8 handlers)
    webhook.ts           # Retell call.completed post-call pipeline
  middleware/
    auth.ts              # Webhook signature verification (Retell SDK)
  resolver/
    businessResolver.ts  # agent_id → business config pipeline
  services/
    booking.ts           # Cal.com booking logic
    crm.ts               # Twenty CRM service layer
    memory.ts            # Caller memory read/write (stale overwrite guard)
    opus.ts              # Post-call Opus processing (async)
    callLog.ts           # Call logging + usage tracking
  integrations/
    calcom.ts            # Cal.com API v2 client
    twenty.ts            # Twenty CRM REST API client
    anthropic.ts         # Anthropic API client (post-call summary)
  config/
    validator.ts         # Business config validation (startup)
    loader.ts            # Load business config from DB
  repositories/
    business.ts          # Business CRUD (always business_id scoped)
    callLog.ts           # Call log CRUD (idempotent webhook)
    memory.ts            # Memory CRUD (business_id + phone scoped)
  types/
    index.ts             # Shared TypeScript types
  lib/
    prisma.ts            # Singleton Prisma client (NEVER instantiate per request)
    logger.ts            # Structured JSON logger with call_id correlation
    errors.ts            # App-specific error types
    validation.ts        # Zod schemas for webhook payloads + function args
    requestContext.ts    # Request context factory
  __tests__/
    resolver.test.ts     # Business resolver tests
    isolation.test.ts    # Multi-tenant isolation tests
    crm.test.ts          # CRM service tests
    validation.test.ts   # Config validation tests
prisma/
  schema.prisma          # 4 models, 7 enums, 2 migrations
scripts/
  seed-business.ts       # Idempotent business seeding
  seed-tekten.json       # Tekten Klinik pilot config
  setup-retell.mjs       # Retell agent + flow + KB creation
  create-agent.mjs       # Retell agent creation
  update-flow-urls.mjs   # Bulk update Retell tool URLs
```

## Error Handling
- Booking (Cal.com create): NO retry — risk of double booking
- Booking conflict (Cal.com 409): catch, tell caller slot taken, re-query availability
- CRM writes (Twenty): 1 retry on failure, then log and continue
- Opus in-call: timeout → fallback message, no retry
- Opus post-call: async, 1 retry. Never blocks CRM writes.
- All errors logged with call_id, business_id, function name, duration_ms, status
- CRM failure → graceful degradation, caller-friendly message, never crash the call

## Post-Call Pipeline
Trigger: Retell call.completed webhook → POST /webhook/call-completed
1. Write call log (idempotent — INSERT ON CONFLICT call_id) → 2. Update caller memory → 3. Write basic CRM note (Twenty) → 4. Opus async (fire-and-forget: summary + enriched note + orphan check) → 5. Update call log + CRM note
Memory and CRM are written before Opus. Opus never blocks. If Opus fails: keep basic CRM note, log failure, continue.
Webhook always returns 200 — Opus runs in background.

## Testing
- Vitest for all tests (18 tests, 4 files)
- Tests: business resolver, multi-tenant isolation, CRM service, config validation
- Mock external APIs (Retell, Cal.com, Twenty) in tests
- Never call real external APIs in automated tests

## Commands
```bash
npm run dev          # Local development (tsx watch)
npm run build        # TypeScript compile to dist/
npm run start        # Production: node dist/server.js
npm run test         # Vitest (18 tests)
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
- API-driven Retell agent creation V1 (setup script ile programatik)
- Multiple event types per business (1:N Cal.com)
- No AI disclaimer in greeting (receptionist presents as human)
- 9 backend functions, 8 Retell tools (reschedule = create + cancel combo in flow)
- Prisma singleton, Zod validation, SIGTERM handling, UTC storage
- Conversation Flow agent (not Single Prompt) — node bazında prompt ve tool izolasyonu
- Cartesia Cleo voice — $0.015/dk, düşük latency, Türkçe desteği
- operating_hours field is informational only (for "what are your hours?" answers)
- Retell outage: developer monitors status page, contacts businesses manually
- Reschedule = create new first, then cancel old (preserves original on failure)
- Webhook idempotency via INSERT ON CONFLICT (call_id) DO NOTHING (race-free)
- CRM note dedup via crm_note_id stored in call_logs
- Opus memory update guarded by last_call_id match (prevents stale overwrite)
- Urgent escalation V1: soft promise only, no real-time notification
- Booking ownership verified by businessId + callerPhone match
- Twenty CRM replaces GHL for V1 — simpler API, lower cost, workspace-level isolation
- Anonymous callers: inquiry only without phone. Booking ops require phone (dual-layer guard).
- Snake_case + camelCase args normalization (Retell sends snake_case)
- Phone normalization: Turkish 0xx → +90xx, args fallback for test calls
- Cal.com booking: no location field, phone in metadata, slot format .000+03:00

## Environment Variables
RETELL_API_KEY, CALCOM_API_KEY, TWENTY_API_KEY, ANTHROPIC_API_KEY,
DATABASE_URL, PORT, NODE_ENV, LOG_LEVEL

## Detailed References
- docs/project-instruction.md — full V1 spec (source of truth)
- docs/schemas.md — all table schemas and config JSON formats
- docs/decisions.md — decision log with rationale
- docs/conversation-flow.md — intents, flows, edge cases
- docs/integrations.md — Cal.com, Twenty, Retell, Opus details
- docs/error-handling.md — retry, timeout, degradation rules
- docs/onboarding.md — business onboarding steps
- docs/v2-research.md — future paths (do not build)
- docs/step0-results.md — Step 0 pre-build validation results
- docs/twenty-api-contract.md — Twenty CRM API details
- docs/calcom-api-contract.md — Cal.com API details
- docs/retell-api-contract.md — Retell webhook contract
- docs/kb-workflow.md — KB update workflow
- docs/spec-divergences.md — spec vs implementation differences
- docs/archive/ghl-original-spec.md — archived GHL spec

## When Compacting
Preserve: multi-tenant safety rules, current implementation phase,
list of modified files, test commands, active build priority step,
any unresolved decisions or blockers from this session.

## Deployment
- **Railway URL:** ai-receptionist-production-f15e.up.railway.app
- **Build:** `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`
- **Start:** `node dist/server.js`
- **Auto-deploy:** push to main → Railway builds and deploys

## Current Phase
V1 Complete — deployed to Railway

## V1 Status
- All 15 build steps completed
- First real booking successful (Cal.com confirmed)
- Retell simulation: 7 tests run, 1 passed, 6 failed (agent_id + booking fixes applied, retest needed)
- **Known issues:**
  - Cal.com booking title/time format needs refinement for agent readback
  - LLM Turkish quality not yet tested with live calls
  - Retell flow fine-tuning needed (transition conditions, edge cases)
