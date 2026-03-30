# Decision Log

Key V1 decisions and rationale (53 decisions across 6 review rounds):

## Stack & Infrastructure
- Retell normal agents (not Custom LLM WebSocket): simpler, sufficient for V1 intent routing
- Prisma over raw SQL: type safety, migration tooling, ecosystem
- Railway single service: solo developer, minimal ops overhead
- Vitest over Jest: faster, modern, TS-native
- Prisma singleton client: one instance shared across all requests, prevents connection exhaustion
- Zod validation on all inbound webhooks: never trust external payload shapes
- graceful shutdown on SIGTERM: drain in-flight requests before exit during Railway deploys
- all timestamps stored UTC internally: convert to business timezone only at conversation layer
- connection pool size: not hardcoded, determined by Railway PostgreSQL plan limits
- standard env var names without prefix: RETELL_API_KEY not APP_RETELL_KEY
- CLAUDE.md includes compaction instructions and current phase tracking

## Deployment
- deploy sequence: push → build → prisma migrate → start → health check, rollback via Railway revert
- no staging environment in V1: test agents + test calls provide sufficient pre-deploy validation
- Railway cold start: test before launch, enable always-on if needed
- health check V1 = DB only: deep external API checks in V2

## Multi-Tenant & Config
- business + integration_configs two-table pattern: clean core table, flexible per-integration config
- config validation failure: invalid business set to is_active=false, WARNING logged, server starts for valid businesses
- is_active for onboarding only: business pause with custom greeting is V2

## Retell
- API-driven Retell agent creation in V1: setup script ile programatik oluşturma (V2'den V1'e çekildi)
- Retell is known SPOF: monitor status page, notify businesses on outage
- Retell normal agent mode: verify 9 custom function support before building (pre-build test item)
- Retell response format: general principle locked (success/result/error), exact shape determined during integration
- KB for static info, backend for all operations: no Retell built-in Cal.com tools in V1
- webhook idempotency via INSERT ON CONFLICT (call_id) DO NOTHING: atomic, race-free, returns 200 on duplicate

## Scheduling (Cal.com)
- Cal.com handles booking conflicts: no backend-level slot locking needed at pilot volume
- Cal.com 1:N event types per business: businesses can have multiple service types

## CRM
- no pipeline in V1: contact + notes sufficient, pipeline adds complexity without V1 value
- crm_write_status field in call_logs: tracks CRM write success/failure/skip per call

## Conversation & Caller
- 9 backend functions for V1: covers all 7 intents plus memory, config lookups, and booking lookup (schedule_followup merged into take_message)
- no AI disclaimer in greeting: receptionist presents as human
- business-level language (one agent = one language): avoids in-call language detection complexity
- language mismatch handled via business config: message_take, generic_fallback, or hang_up
- V1 is inbound only: no outbound calling, outbound is V2 research path
- simultaneous intent: AI asks caller to clarify reschedule vs cancel+rebook, never assumes
- batch cancel not in V1: AI asks which booking to cancel, one at a time
- urgent escalation (not emergency): per-business config defines situations, notify contact, response time
- callback tracking via CALLBACK_PENDING flag in CRM note: business responsible for follow-through
- verbal booking confirmation only: no SMS/email in V1, reduces integration surface
- lookup_bookings required before cancel/reschedule: search by phone, narrow by date/name

## Data & Memory
- phone numbers stored in E.164 + raw_phone: normalized for lookups, raw for debugging
- phone spoofing risk accepted in V1: memory data is low-sensitivity
- caller_name updated when provided, kept when not: handles shared phone numbers
- memory written immediately after call (before Opus): prevents repeat-caller race condition
- call_logs and caller_memory table schemas defined at field level: exact Prisma types during implementation
- usage tracking derived from call_logs queries in V1: no separate metrics table
- no data retention automation in V1: monitor growth, decide retention policy in V2
- no formal call state machine in V1: disposition + last_step fields sufficient for tracking

## Opus
- post-call pipeline triggered by Retell webhook: async Opus processing, never blocks CRM writes

## Scope
- no KVKK/GDPR implementation in V1: not in scope until explicitly requested
- no billing in V1: pilot phase, usage tracked for future pricing
- no spam filtering in V1: low call volume expected, cost risk accepted
- operating hours split-shift capable: array of time ranges per day, no holiday model in V1

## Agent Behavior
- agent operates 24/7 with identical behavior at all times: no after-hours mode, no time-based intent restrictions
- operating_hours field is informational only: used for answering "what are your hours?", does not change agent behavior
- availability driven by Cal.com data: if no slots exist (any time of day), agent offers alternatives or message taking naturally

## Observability
- duration_ms logged on every function call execution, not just timeouts: enables latency visibility before problems escalate
- request context object { callId, businessId, functionName, startTime, callerPhone } created at handler entry: passed through all service calls for structured logging and tracing

## Onboarding
- onboarding seed script takes JSON config and automates DB steps (business record, integration configs, validation): reduces manual error for steps 2, 7, 8
- Retell outage notification V1: developer monitors status page and contacts businesses manually (WhatsApp/phone)

## Function Design (Review Round 7)
- schedule_followup merged into take_message with type param (message|callback|urgent): reduces function count from 10 to 9, cleaner API surface
- reschedule_booking creates new booking first, then cancels old: prevents caller losing appointment if new booking fails
- lookup_bookings returns max 3 results, agent presents by date + provider for voice disambiguation
- backend safety net: cancel/reschedule rejected if no prior lookup_bookings for this call_id, regardless of Retell behavior
- booking ownership verification: bookingId must match businessId + callerPhone before cancel/reschedule executes. V1 authorized by phone match only — pilot businesses informed.

## Resilience (Review Round 7)
- CRM note dedup via crm_note_id stored in call_logs: prevents duplicate notes from retries
- Opus memory update guarded by last_call_id match: prevents stale overwrite when rapid successive calls cause out-of-order Opus completion
- urgent escalation V1: soft promise only ("flagging as priority"), no real-time notification to notify_contact. notify_contact and response_time_promise fields kept in schema for V2.
- CRM token lifecycle documented during Twenty API spike (Bearer token per workspace, no refresh needed)

## Pre-Build (Review Round 7)
- write and test Retell agent system prompt for first pilot business BEFORE building backend: the prompt is the product, the backend is plumbing
- Retell function call authentication mechanism must be confirmed during spike: signature verification, shared secret, or alternative
- Cal.com date conversion responsibility must be decided during spike: does Retell agent or backend convert "tomorrow afternoon" to structured date range?

## Step 0 Decisions (Review Round 8)
- Retell Conversation Flow agent seçildi (Single Prompt değil): node bazında prompt/tool izolasyonu, fonksiyon sırası yapısal garanti, daha az hallucination
- API-driven agent creation: V2'den V1'e çekildi, setup script ile programatik oluşturma
- Retell tool sayısı 8 (reschedule_booking ayrı tool değil): rescheduling = create_booking + cancel_booking kombinasyonu, backend'de hâlâ 9 fonksiyon
- Cartesia Cleo voice: ElevenLabs'ın 1/3 fiyatına ($0.015/dk vs $0.04/dk), düşük latency (~40-90ms), Sonic 3 ile Türkçe desteği
- Cal.com ve CRM API spike'ları ayrı phase yerine backend integration adımında yapılacak: ayrı spike gereksiz tekrar
- Dynamic variables kullanımı: {{current_time_Europe/Istanbul}}, {{user_number}} gibi Retell built-in değişkenler prompt'ta kullanılıyor

## CRM Migration (Step 6)
- Twenty CRM replaces GHL for V1: lower cost ($12/seat vs $97/mo), simpler API, workspace-level isolation
- CRM integration module isolated in src/integrations/twenty.ts — GHL swap possible in 1-2 days
- Phone search via client-side filter: Twenty REST API doesn't support composite field filtering
- Notes use bodyV2 (RICH_TEXT with markdown input), linked to people via separate noteTargets endpoint
- crm_note_id (renamed from ghl_note_id) for CRM note dedup
- Original GHL spec archived in docs/archive/ghl-original-spec.md

## Anonymous Caller Handling
- V1: inquiry (KB answers) only without phone number. Message taking also requires phone — clinic cannot call back without a number.
- Booking, cancel, reschedule require phone — agent asks for phone verbally if caller_id missing
- Detection: dual-layer guard
  - Primary: Retell Conversation Flow checks {{user_number}} before routing to booking nodes
  - Safety net: Backend function handlers validate callerPhone before mutation operations
- If caller refuses to provide phone: message taking only, agent explains booking requires phone
- CRM contact NOT created for anonymous callers (no phone = no dedup key)
