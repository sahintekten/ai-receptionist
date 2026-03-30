You are helping me build a multi-business AI receptionist platform.

Act as a product architect, backend engineer, and implementation partner.
Do not treat this as a one-off single-clinic bot.
Treat it as a reusable multi-tenant platform from day one.

# Mission

Build a voice AI receptionist platform that serves multiple businesses from one shared backend and one shared codebase.

Each business should have:
- its own Retell agent
- its own phone number
- its own business-specific knowledge base
- its own scheduling configuration
- its own CRM location
- its own business-scoped customer memory

Externally, each business should feel like it has its own receptionist.
Internally, the platform should remain centrally managed, config-driven, and multi-tenant.

# Locked V1 stack

Use this as the default architecture unless I explicitly change it:

- Retell AI for voice calls, conversation flow, knowledge base usage, and tool/function invocation
- Node.js + TypeScript for the backend
- PostgreSQL as the main source of truth for system state and configuration
- Prisma as the ORM and migration tool
- Cal.com for scheduling
- GoHighLevel for CRM
- Railway for backend hosting (single service, auto-deploy on push to main)
- Vitest for testing
- Opus as a selective reasoning layer
- a fast live conversation model chosen by testing

# Locked V1 architecture decisions

## Retell mode
For V1, use normal Retell agents with conversation flow, knowledge base, and platform-level call controls (e.g., end_call). All state-changing operations (scheduling, CRM, memory) go through backend custom functions. Do not use Retell built-in Cal.com tools.

Do not assume V1 uses full Custom LLM WebSocket as the default architecture.

## Backend shape
Use one shared backend for all businesses.

Use:
- one public Retell function entrypoint
- internal routing by function name + business context

Do not create many public endpoints for each individual Retell function unless explicitly requested.

## Backend function inventory
These custom functions will be registered in Retell and routed through the single backend entrypoint:

1. check_availability(businessId, dateRange, serviceType) — query Cal.com for open slots
2. create_booking(businessId, callerPhone, slot, eventTypeId, callerName?) — book via Cal.com + write CRM
3. cancel_booking(businessId, bookingId, callerPhone) — cancel via Cal.com + update CRM
4. reschedule_booking(businessId, bookingId, newSlot, callerPhone) — create new booking first, then cancel old. If new booking fails, old is preserved. If new succeeds but old-cancel fails, flag as double booking for review.
5. take_message(businessId, callerPhone, messageText, callerName?, type: message | callback | urgent) — write to CRM note. type=message: standard message. type=callback: adds CALLBACK_PENDING flag. type=urgent: adds URGENT flag.
6. get_caller_memory(businessId, callerPhone) — load memory for personalization
7. get_business_hours(businessId) — return operating hours from config
8. get_emergency_info(businessId) — return urgent escalation config (situations, escalation_message)
9. lookup_bookings(businessId, callerPhone, name?, dateHint?, status?) — find existing bookings for cancel/reschedule. Returns max 3 results. Agent presents each by date + provider name for voice disambiguation.

lookup_bookings is required before cancel_booking or reschedule_booking can execute.
Flow: caller asks to cancel/reschedule → lookup_bookings by phone → if multiple results, narrow by date or name → then cancel or reschedule the identified booking.

Backend safety net for function ordering: if cancel_booking or reschedule_booking is called and no prior lookup_bookings result exists for this call_id, reject the call with an error telling the agent to look up the booking first. This protects against Retell skipping the lookup step.

Booking ownership verification: cancel_booking and reschedule_booking must verify that the bookingId belongs to the resolved businessId + callerPhone before executing. V1 accepts that authorization is by phone number match only — pilot businesses are informed of this limitation.

Every function receives call_id and agent_id from Retell context for logging and business resolution.
Function names and parameter shapes may be refined during Retell integration, but the inventory above is the V1 scope.

## Business resolution
Use a resolver pipeline.

Priority:
1. agent_id
2. business metadata
3. telephony mapping
4. other safe fallback methods if later needed

Do not permanently rely on only one field.

## Database tenancy
Use one shared PostgreSQL database with business_id scoping on tenant-scoped tables.

For V1:
- enforce tenant isolation at the application/repository layer
- design schema and repository patterns so RLS can be added later without a rewrite
- use Prisma for schema management and migrations

## Business config schema
Use a two-table pattern:

Table: businesses (core identity)
- id, name, language, timezone, operating_hours (jsonb), greeting_text, closing_text, filler_speech, fallback_message, degradation_mode (message | callback), language_mismatch_action (message_take | generic_fallback | hang_up), urgent_escalation_config (jsonb), phone_number, retell_agent_id, kb_reference, enabled_intents (jsonb array), created_at, updated_at, is_active

urgent_escalation_config JSON format:
```
{
  "situations": ["post-surgical complications", "allergic reaction", "severe pain"],
  "notify_contact": "+905551234567",
  "response_time_promise": "30 minutes",
  "escalation_message": "I understand this is urgent. Someone from the clinic will call you back within 30 minutes."
}
```

operating_hours JSON format (split-shift capable):
```
{
  "monday": [{ "open": "09:00", "close": "12:00" }, { "open": "13:00", "close": "17:00" }],
  "tuesday": [{ "open": "09:00", "close": "17:00" }],
  ...
  "sunday": []
}
```
Empty array = closed that day. Multiple objects per day = split shifts (e.g., lunch break).
All times are in the business's configured timezone.
Holidays are not modeled in V1. If a business is closed on a holiday, Cal.com availability will reflect no open slots and the agent will handle it naturally.

Table: integration_configs (per-integration settings)
- id, business_id (FK), integration_type (enum: calcom | ghl | retell | anthropic), config_json (jsonb), is_enabled, created_at, updated_at

integration_type + config_json examples:
- calcom: { event_types: [{ id, name, duration_minutes, service_type }], availability_mode: "cal_only" | "cal_plus_gcal", gcal_calendar_id? }
- ghl: { location_id, contact_search_enabled: true }
- retell: { agent_id, webhook_url }
- anthropic: { model_id, max_tokens, temperature }

This pattern keeps the business table clean while allowing flexible per-integration config.
Config validation checks both tables at startup.

## Model strategy
Do not hardcode one live model for all languages.

For English, GPT-4.1 is a strong likely candidate.
For Turkish, do not assume the best model in advance.
Live model choice should be decided by testing quality, latency, instruction-following, and business suitability.

For V1:
- use a fast live model for ordinary conversation
- use Opus only when stronger reasoning is actually needed
- keep model selection configurable by language and later by business if needed

## Language strategy
For V1, each business has one default language.
Each agent speaks one language.

If a business needs multiple languages, it gets multiple agents (one per language), each with its own phone number or routing.

Do not build in-call language detection or switching for V1.
Do not build mixed-language agent support for V1.

Model selection is tied to language at the config level.

## Knowledge base vs Opus
Use KB for facts.
Use Opus for judgment.

KB is for:
- address
- hours
- services
- providers
- policies
- FAQs
- pricing guidance
- mostly static business information

KB is NOT the source of truth for:
- live availability
- booking state
- CRM state
- call state
- customer memory

Use Opus for:
- edge-case decisions
- post-call summaries
- CRM enrichment
- KB draft generation and cleanup
- transcript review
- detecting missing FAQs
- improving prompts and conversation flow
- checking for incomplete bookings from interrupted calls

## Calendar strategy
For V1, use a hybrid approach:

Retell KB handles static information:
- business hours, services offered, provider names, pricing guidance, policies, FAQs
- any information that does not require real-time data or state changes

Backend functions handle all state-changing operations:
- availability checks (real-time Cal.com query)
- booking creation
- booking cancellation
- booking rescheduling
- any operation that writes to CRM, updates memory, or requires tenant-aware logic

Do not use Retell's built-in Cal.com tools for V1.
All scheduling operations go through backend functions to ensure CRM writes, memory updates, logging, and business-scoped validation happen consistently.

This means every Cal.com interaction is controlled by the backend, which enables:
- consistent CRM side-effects on every booking action
- memory updates tied to booking outcomes
- business-scoped logging and usage tracking
- unified error handling and fallback behavior

## Cal.com topology
For V1:
- use a single Cal.com account
- use per-business event types / config mappings

Possible V2 path:
- evaluate Teams / organization structure if operational complexity grows

## Cal.com event type model
V1 supports multiple event types per business (1:N relationship).

Examples: a clinic may have "initial consultation," "follow-up visit," "emergency slot."

Each event type is stored in integration_configs as part of the calcom config_json:
- event_type_id, event_type_name, duration_minutes, service_type

When a caller requests a booking, the AI determines the appropriate event type from the conversation context (service requested, provider mentioned, etc.) and passes the correct event_type_id to check_availability and create_booking.

If the caller doesn't specify a service type, the AI asks. If the business has only one event type, it is used by default.

## Cal.com availability source of truth
Business config determines the availability mode per business:
- option A: Cal.com only (clinic manages availability entirely in Cal.com)
- option B: Cal.com + Google Calendar two-way sync (clinic uses GCal, synced to Cal.com)

The backend always queries Cal.com for availability regardless of mode.
The mode only affects how the clinic manages their calendar upstream.

## Booking confirmation
For V1, no SMS or email confirmation is sent after booking.
The AI receptionist gives verbal confirmation on the call (date, time, provider).

Possible V2 path:
- Cal.com built-in confirmations or GHL workflow-triggered SMS/email

## Telephony strategy
Do not hardcode one final phone-number type yet.

Treat telephony as business-scoped configuration.
Each business must have:
- one phone number
- one Retell agent mapping
- one telephony config

Number standards such as 0850 vs 0510/0516 can be finalized later without redesigning the backend.

## CRM strategy
Use one GoHighLevel agency account.
Use one separate location per business.

Every call should create or update CRM state.
Do not limit CRM writes only to booked calls.

For V1:
- use direct API writes from the backend
- optionally add GHL workflow triggers later if needed
- no pipeline/opportunity tracking in V1 (contact + notes only)
- pipeline tracking is a V2 path if needed

For each call, the system should be able to write:
- caller identity if available
- phone number
- business called
- summary
- disposition
- booking outcome if any
- message left if any
- relevant notes

All CRM writes must always go to the correct business location.

## GHL contact deduplication
Use phone number as the primary match key.

For every call:
1. search for existing contact by phone number in the business location
2. if found, update the existing contact with new call data
3. if not found, create a new contact

Do not create duplicate contacts for the same phone number within a business location.

## GHL CRM note deduplication
Store `crm_note_id` in call_logs after the first successful CRM note write.
Before writing or retrying a CRM note, check if `crm_note_id` is already populated for this call_id.
If yes, update the existing note instead of creating a new one.
This prevents duplicate CRM notes from retries or timeout-then-success scenarios.

## Memory strategy
Use light operational memory in V1.

Allowed V1 memory examples:
- caller name
- phone number
- last contacted business
- recent appointment status
- recent message left
- recent summary

Do not build deep personality-style memory in V1.
Memory must always be scoped by business + phone number.

If current confirmed call data conflicts with stored memory, prefer current confirmed data.

Caller name update rule: if the caller provides a name during the call, update caller_name in memory. If the caller does not provide a name, keep the existing stored name. This handles shared phone numbers (family phones) where different people may call from the same number.

Memory write timing: basic memory updates (caller_name, last_call_at, recent_appointment_status) are written immediately after the call ends, BEFORE the async Opus post-call pipeline. This ensures a repeat caller within minutes sees updated memory. Opus-generated fields (summary enrichment) are written later when Opus completes.

Stale overwrite guard: when Opus finishes and attempts to update caller memory, it must check that `last_call_id` still matches the call being processed. If a newer call has already updated memory (different `last_call_id`), Opus skips its memory update for the stale call. This prevents rapid successive calls from corrupting memory with out-of-order Opus results.

Possible V2 memory expansion:
- preferred provider
- preferred time
- recurring service interest
- repeat-caller workflow hints

Only suggest V2 memory expansion if real workflow value is clear.

## Opus strategy
Use conservative Opus usage in V1.

Rule:
- normal calls should not constantly call Opus
- Opus should only be used when stronger reasoning is genuinely needed

Approved V1 Opus use cases:
- unclear or high-stakes in-call decision support
- post-call summary
- CRM note generation
- lead / intent enrichment
- KB draft generation from messy materials
- finding missing FAQ entries
- suggesting prompt or flow improvements
- checking interrupted calls for orphaned bookings or incomplete actions

Locked behavior:
- in-call Opus = rare + synchronous + timeout + fallback
- post-call Opus = async by default

Do not use Opus as the default live-turn model for every call in V1.

## Post-call processing pipeline
Trigger: Retell sends a call.completed webhook when a call ends.

Pipeline steps (async, non-blocking):
1. backend receives call.completed webhook with call_id, agent_id, transcript, call metadata
2. resolve business from agent_id
3. write initial call log (disposition, last_step, duration, caller_phone, raw metadata)
4. write/update caller memory immediately (caller_name, last_call_at, recent_appointment_status, recent_message_summary)
5. write/update CRM contact + basic call note in GHL (immediate, before Opus)
6. send full transcript + call metadata to Opus async
7. Opus generates: summary, enriched CRM note, orphaned booking check result
8. update call log with Opus summary
9. update CRM note with enriched Opus output
10. if orphaned booking detected: flag in call log for human review

Steps 3-5 are synchronous and fast — they ensure memory and CRM are up to date before any repeat call.
Steps 6-10 are async — Opus processing does not block the pipeline.

Input to Opus: full Retell transcript + call metadata (business_id, caller_phone, disposition, intents detected)
Output from Opus: structured summary, CRM-ready note text, orphaned_booking flag (boolean + details)

KB gap detection is a V2 Opus task. Do not include in V1 post-call pipeline.

Failure handling: if Opus fails after 1 retry, keep the basic CRM note from step 4 and log the Opus failure. Never block CRM writes on Opus success.

## Call lifecycle tracking
V1 does not use a formal state machine for call lifecycle.

Instead, each call log records:
- disposition: completed | interrupted | failed | no_answer
- last_step: greeting | intent_detection | availability_check | booking | cancellation | rescheduling | message_taking | emergency | followup | closing
- post_processing_status: pending | completed | failed | skipped

This provides enough granularity for debugging and reporting without the overhead of a state machine.

Possible V2 path: formal state machine with transition logging if call flow complexity grows.

## KB workflow
For V1, the KB workflow is semi-automated.

Flow:
1. Opus generates a KB draft from messy source material
2. a human reviews and approves it
3. approved KB content is uploaded to Retell

V2 option:
- after approval, approved KB content may be published via backend/API instead of manual upload

## Observability
V1 must include structured logging and call-level correlation.

Rules:
- correlation ID = call_id
- every important service call should include it

At minimum, log on every function call:
- call_id
- business_id
- agent_id
- action / function name
- duration_ms (measured on every function execution, not just timeouts)
- status (success / failure)
- relevant metadata
- error details where applicable

Request context pattern: at the start of every function call handler, create a context object `{ callId, businessId, functionName, startTime, callerPhone }`. Pass this through the entire execution chain. Use it for all logging and error tracking. This enables tracing a complete function execution from a single `call_id` query.

## Monitoring
For V1:
- use Railway built-in logs as the primary log destination
- expose a /health endpoint for uptime monitoring
- no external log aggregator or alerting service required in V1
- Retell outage notification: V1 uses manual notification. Developer monitors Retell status page and contacts affected businesses directly (WhatsApp/phone) if Retell is down.

Possible V2 path:
- add Betterstack, Logflare, or Slack alerts if operational needs grow

## Rate limiting and cost controls
Do not build hard rate limits immediately in V1.

Instead, log per-business usage and cost-related activity from the start.

Track at minimum:
- call volume per business
- call duration per business
- Opus usage per business
- booking attempts
- CRM writes
- failures / retries

Reason:
this is a multi-tenant system, so one business can create disproportionate load and affect others.

Possible V2 path:
- add tenant-based rate limits, throttling, or quotas if real usage patterns justify them

## Pricing strategy
V1 is a free pilot phase.
No billing or payment collection in V1.
Pilot businesses use the platform at no cost.

Usage tracking from the cost controls section provides data for future pricing decisions.

Possible V2 pricing models to evaluate based on pilot data:
- per-call or per-minute pricing
- monthly flat fee per business
- tiered plans with call limits

## Configuration validation
V1 must include per-business config validation.

Invalid or incomplete tenant config should be caught during startup or onboarding, before production calls fail.

Validation should check at minimum:
- agent mapping
- phone mapping
- calendar config
- GHL config
- KB presence / reference
- required integration settings
- conflicting or duplicate mappings

Config validation failure behavior:
- if a business has invalid or incomplete config at startup, set its is_active to false
- log a WARNING with the business_id and the specific validation errors
- continue starting the server for all other valid businesses
- never refuse to start the server because of one invalid business
- the invalid business will not receive calls until its config is fixed and validated

# V1 conversation flow

## Supported intents
V1 supports these caller intents:
1. appointment booking (check availability, select slot, confirm booking)
2. appointment cancellation
3. appointment rescheduling
4. general inquiry (hours, address, services, pricing, providers, policies)
5. message taking (caller leaves a message for the business)
6. urgent escalation (caller describes a situation the business defines as urgent)
7. follow-up scheduling (business promised a callback, caller asks about it)

Each intent should have a defined happy path and at least one fallback path in the conversation flow.

## Call direction
V1 is inbound only. The platform answers incoming calls.
Outbound calling (business calling patients back) is not supported in V1.

Possible V2 path:
- outbound call support for appointment reminders or callback fulfillment

## Conversation structure
General flow for every call:
1. greeting (business-specific, language-specific)
2. intent detection (what does the caller need?)
3. intent routing (route to the correct sub-flow)
4. action execution (booking, lookup, message capture, etc.)
5. confirmation or fallback (confirm result or explain what happens next)
6. closing (business-specific closing)

## Greeting stance
The AI receptionist greets callers as a real human receptionist would.
No AI disclaimer, no "this call is handled by AI" message, no recording notice.
The experience should be indistinguishable from a human receptionist.
Greeting text is fully customizable per business in the business config.

## Simultaneous intent handling
When a caller expresses multiple intents at once (e.g., "I want to cancel my appointment and book a new one"):
- the AI asks for clarification: "Would you like to reschedule your existing appointment to a new time, or cancel it entirely and book a separate appointment?"
- do not assume reschedule vs cancel+rebook — let the caller decide
- route to the appropriate sub-flow based on the caller's response

## Cancellation of multiple bookings
V1 does not support batch cancellation.
If lookup_bookings returns multiple results, the AI asks the caller to specify which booking to cancel (by date, provider, or service).
"Cancel all" requests are handled one at a time with individual confirmation for each.

Possible V2 path:
- batch cancel with single confirmation

## Urgent escalation
V1 uses "urgent escalation" instead of "emergency routing."

Each business defines in its config:
- what situations qualify as urgent (e.g., post-surgical complications for a medical clinic, allergic reaction for a beauty clinic)
- who should be notified — `notify_contact` field (V1: stored but not acted on. V2: real-time notification)
- what response time to promise — `response_time_promise` field (V1: stored but not used in caller-facing speech. V2: used when real notification is implemented)
- `escalation_message` — the soft message the agent uses in V1 (e.g., "I'm flagging this as priority for the team")

V1 behavior: The AI uses the business config `situations` list to determine urgency. When a caller describes an urgent situation:
- acknowledge the urgency
- deliver the configured `escalation_message` (soft promise, no specific callback time)
- log the call via `take_message(type=urgent)` which writes CRM note with URGENT flag
- the business is responsible for monitoring CRM and following up

V1 does NOT send real-time notifications to `notify_contact`. V1 does NOT promise a specific response time to the caller. These are V2 features. Pilot businesses are informed: "urgent means we flag it in your CRM, not that we page your doctor."

get_emergency_info function returns the business's urgent escalation config (`situations`, `escalation_message`).

## Language mismatch
Each business config includes a language_mismatch_action setting:
- message_take: switch to message-taking in the caller's detected language if possible, or use simple phrases
- generic_fallback: deliver a pre-configured message in the alternate language (e.g., "Please leave a message, someone will call you back")
- hang_up: politely end the call with a brief message

The AI should detect language mismatch early in the conversation (within the first few exchanges) and apply the configured action.

## Callback tracking
When `take_message(type=callback)` is called, the CRM note includes a CALLBACK_PENDING flag.
When `take_message(type=urgent)` is called, the CRM note includes an URGENT flag.

V1 does not track whether callbacks were actually completed — that is the business's responsibility.
The flags exist so the business can filter and act on pending items in GHL.

## 24/7 Behavior
The AI receptionist operates 24/7 with identical behavior at all times. There is no after-hours mode.
If a caller requests a booking and no slots are available (whether at 3am or during a fully booked week), the agent says so naturally and offers alternative dates or message taking. Availability is driven by Cal.com data, not time-of-day rules.
The `operating_hours` field exists for informational purposes only — so the agent can answer "what are your hours?" from the KB. It does not change agent behavior.

## Transfer to human
V1 does not support live call transfer to a human.
If the AI cannot resolve the caller's request:
- take a message
- log the call as requiring human follow-up
- inform the caller that the business will call back

Possible V2 path:
- SIP transfer or warm handoff to a live receptionist

# Error handling and resilience

## Timeout behavior
When a backend function call takes too long:
- Retell plays business-configurable filler speech while waiting ("One moment, I'm checking that for you...")
- if the function does not respond within the timeout window, deliver a business-configurable fallback message
- log the timeout with call_id, function name, and duration

## Graceful degradation
When a downstream service is unavailable (Cal.com down, GHL API error, etc.):
- behavior is determined by business config
- option A: switch to message-taking mode ("I'm unable to book right now, but I can take a message and the clinic will call you back")
- option B: promise a callback ("We're experiencing a temporary issue. Someone from the clinic will call you back shortly")
- every degraded call must be logged with the failure reason and the fallback path taken

## Retry strategy
Retry behavior depends on the integration:
- booking operations (Cal.com create): NO retry (risk of double booking)
- CRM writes (GHL contact/note): 1 retry on failure, then log and continue
- memory reads/writes (PostgreSQL): 1 retry on transient error
- Opus calls: no retry for in-call (timeout to fallback), 1 retry for post-call async

All retries must be logged with attempt count and final status.

## Concurrent booking
Cal.com handles slot-level conflict detection.
If two callers attempt to book the same slot simultaneously:
- the first booking succeeds
- the second receives a conflict response (Cal.com 409 or equivalent)
- backend catches the conflict and tells the caller: "That slot was just taken. Let me check other available times."
- backend re-queries availability and offers alternative slots

Do not build backend-level booking locks in V1. Cal.com's built-in conflict handling is sufficient at pilot volume.
Log every booking conflict with call_id, business_id, requested_slot, and conflict_reason.

## Interrupted call handling
When a caller hangs up mid-conversation:
- log the call with disposition = interrupted and the last completed step
- if a booking request was sent to Cal.com but not confirmed to the caller, flag it for post-call Opus review
- Opus post-call check determines if an orphaned booking exists and logs the finding
- do not auto-cancel bookings; flag for human review

## Spam and robocall handling
V1 does not include spam filtering.
Retell processes every inbound call.

Log call duration and caller behavior patterns for future analysis.

Possible V2 path:
- short-call detection (calls < 5 seconds = auto-log as spam)
- repeat-caller throttling

## Retell platform outage
Retell is a single point of failure. If Retell is down, calls cannot be answered by the AI.
The backend cannot mitigate this — there is no fallback call answering system.

V1 mitigation:
- monitor Retell status page for outages
- notify affected businesses if Retell is down so they can answer calls manually
- log any detected outage period

Possible V2 path:
- telco-level call forwarding to the clinic's direct number when Retell is unreachable

# Security

## Webhook authentication
Verify that inbound requests to the Retell function entrypoint are genuinely from Retell.

If Retell supports webhook signature verification, use it.
Otherwise, use a shared secret header that the backend validates on every request.

Reject any request that fails authentication. Log rejected requests.

## Webhook idempotency
Retell may deliver the same webhook (e.g., call.completed) more than once.

Use `INSERT ... ON CONFLICT (call_id) DO NOTHING` and check affected row count:
1. attempt to insert call log with the incoming call_id
2. if 0 rows inserted (conflict), it's a duplicate — return 200 with "already processed", log the duplicate
3. if 1 row inserted, proceed with the post-call pipeline

Do NOT use SELECT-then-INSERT — this has a race condition when two identical webhooks arrive within milliseconds. The INSERT ON CONFLICT pattern is atomic and race-free.

## Phone number normalization
All phone numbers are stored in E.164 format (+905551234567) as the normalized form.
The original format received from Retell is also stored as raw_phone for debugging.

Normalization happens at the earliest point: when the webhook payload is parsed.
All lookups (memory, CRM dedup, booking search) use the normalized E.164 form.

The caller_memory table and call_logs table both store normalized_phone (E.164) and raw_phone.

## API key and secret management
For V1:
- store all API keys and secrets in Railway environment variables
- never commit secrets to source code or config files
- document a secret rotation procedure (how to rotate each key without downtime)

Keys to manage:
- Retell API key
- Cal.com API key
- GHL API key / OAuth tokens
- Anthropic API key (for Opus)
- database connection string
- webhook shared secret

Environment variable names:
- RETELL_API_KEY
- CALCOM_API_KEY
- GHL_API_KEY
- ANTHROPIC_API_KEY
- DATABASE_URL
- WEBHOOK_SECRET
- PORT
- NODE_ENV
- LOG_LEVEL

All stored in Railway environment variables. Never prefix with APP_ or custom namespace.
Document a rotation procedure for each key.

Possible V2 path:
- migrate to a dedicated secret manager (Doppler, Infisical) if key count or rotation frequency grows

## Phone number spoofing awareness
V1 uses caller phone number as a memory and CRM matching key.
Phone numbers can be spoofed.

V1 accepts this risk. Memory data is low-sensitivity (name, recent appointment status).
Do not build phone verification in V1.

Log this as a known limitation.

# Data retention

V1 does not implement automatic data deletion or expiry.
All call logs, memory records, and CRM data are retained indefinitely.

Monitor database growth during pilot phase.
Data retention policies (auto-deletion schedules, archival, memory expiry) are a V2 decision based on actual data volume from pilot usage.

Known compliance note: if KVKK/GDPR becomes relevant, data retention and deletion capabilities will need to be added.

# Multi-tenant safety rules

This is a multi-tenant platform.

Never assume a default business.
Never allow cross-business data leakage.

Every action must resolve in this order:
1. identify the agent or phone number
2. resolve the business
3. load that business config
4. load enabled integrations
5. execute in that business context
6. log the result

Everything below must always be business-scoped:
- agent mapping
- phone mapping
- KB
- calendar config
- CRM location
- memory
- logs
- variables
- tool availability

# Layer responsibilities

Use this mental model:

- Retell speaks and manages the call flow
- KB provides facts
- Backend orchestrates and executes custom logic
- Cal.com handles scheduling
- GoHighLevel handles CRM
- PostgreSQL stores system state and configuration
- Prisma manages schema and migrations
- Opus reasons only when useful
- Vitest validates correctness

# Data ownership

PostgreSQL is the primary source of truth for:
- businesses
- agents
- phone mappings
- business configs
- integration configs
- enabled functions
- customer memory references
- call logs
- KB references
- model routing config if added later
- usage tracking data

GoHighLevel is the CRM system for:
- contacts
- notes
- pipeline/opportunity data if used in V2

Cal.com is the scheduling engine for:
- availability
- booking
- rescheduling
- cancellation

JSON is allowed only for:
- templates
- examples
- seed fixtures
- local mock configs
- KB draft formats

Do not use JSON as the primary production source of truth.

# Database table schemas

See schemas.md for complete field-level definitions of all tables.

Tables: businesses, integration_configs, call_logs, caller_memory.
Usage tracking derived from call_logs (no separate table V1).
The businesses and integration_configs table structures are also described in the business config schema section above (with JSON format examples).

# Retell function response format

Every backend function returns a consistent response structure to Retell.
General principle:
- on success: return result data that Retell uses to continue the conversation
- on failure: return an error with a caller-friendly message that Retell speaks as fallback

Exact response shape will be determined during Retell integration (step 4 of build priority), as it depends on Retell's expected format. Document the finalized format in docs/retell-contract.md.

The backend must never return raw error stacks or internal details to Retell.
Every error response must include a user_message suitable for the AI to speak to the caller.

# Deployment and infrastructure

## Railway configuration
- single Railway service for V1
- auto-deploy on push to main branch
- PostgreSQL provisioned as a Railway plugin
- environment variables for all secrets and config

## Deployment sequence
On push to main:
1. Railway builds the application
2. Prisma migration runs automatically (`prisma migrate deploy`)
3. Application starts
4. Health check endpoint must return OK before Railway routes traffic

If build or migration fails, deploy is aborted. No traffic is routed to the failed instance.

Rollback: use Railway's built-in "revert to previous deployment" feature. If a Prisma migration needs rollback, create a new corrective migration (Prisma does not support automatic down migrations in production).

## Health check
V1 health check (/health) verifies:
- application is running
- database connection is alive (simple query)

Returns 200 if healthy, 503 if not.

Possible V2 path:
- deep health check that also verifies Retell API, Cal.com API, and GHL API reachability

## Railway cold start
Railway may sleep inactive services. Retell function calls require fast backend responses.

Action for pilot phase: test cold-start latency before going live. If latency is unacceptable, enable Railway always-on or implement a keep-alive cron.

This is a pre-launch validation item, not a design decision to lock now.

## Database migrations
Use Prisma for all schema changes.
- every schema change requires a Prisma migration
- migrations must be reviewed before applying to production
- never use raw SQL to alter production schema outside of Prisma

## Environment strategy
For V1:
- one environment: production (Railway main branch)
- use Retell test agents and test phone numbers for pre-deploy validation
- no separate staging environment in V1

Possible V2 path:
- add a staging Railway environment on a staging branch

## Backup
Rely on Railway's built-in PostgreSQL backup for V1.
Document the recovery procedure.

## Infrastructure decisions

Prisma client: use a singleton pattern. One Prisma client instance shared across all requests. Do not instantiate a new client per request — this causes connection pool exhaustion under concurrent calls.

Input validation: use Zod schemas to validate all inbound webhook payloads (Retell function calls, call.completed webhooks) before processing. Never trust external input shapes.

Graceful shutdown: handle SIGTERM signal from Railway during deploys. Drain in-flight requests before process exit. Do not kill active function calls mid-execution.

Timezone convention: all timestamps stored in UTC in PostgreSQL. Convert to business timezone only at the conversation layer (when the AI speaks times to the caller). Internal services, logs, and call records always use UTC.

Connection pooling: use Prisma's default connection pool. Do not hardcode a specific pool size in the instruction — determine the optimal value based on Railway PostgreSQL plan limits during deployment.

# Testing strategy

## Framework
Use Vitest for all tests.

## V1 test scope
At minimum, V1 must have tests for:
- business resolver (correct business is resolved from agent_id, phone number, etc.)
- multi-tenant isolation (Business A data never leaks to Business B queries)
- service layer functions (booking, CRM write, memory read/write)
- config validation (invalid config is caught before production calls)

## Integration test approach
- mock external APIs (Retell, Cal.com, GHL) in tests
- use a test database or Prisma's in-memory approach for database tests
- do not call real external APIs in automated tests

## End-to-end validation
- use Retell's test call feature to validate full call flows before going live with a new business
- document a manual E2E checklist for new business onboarding

# Business onboarding

## Retell agent creation strategy
V1 uses manual agent creation in the Retell dashboard.

For each new business:
- create a new agent in Retell dashboard
- configure conversation flow based on a standard template
- upload business-specific KB
- assign phone number
- set webhook URL to the shared backend entrypoint
- configure voice, language, and model settings

Document a standard agent configuration template so all agents are consistent.
Store the template spec in docs/retell-agent-template.md.

Possible V2 path:
- automate agent creation via Retell API during onboarding

## V1 onboarding process
V1 uses a manual onboarding workflow:

1. collect business information (name, address, hours, services, providers, language)
2. create business record in PostgreSQL via seed script or direct SQL
3. create Retell agent manually (following standard template)
4. upload business-specific KB to Retell agent
5. assign phone number to agent in Retell
6. create GHL location for the business
7. create Cal.com event types for the business (one or more per service)
8. add business config to the database (agent mapping, phone mapping, calendar config, GHL config)
9. run config validation
10. perform test call via Retell test feature
11. test cold-start latency if this is the first business on the instance
12. go live

## Config validation on onboarding
Every new business must pass config validation before receiving production calls.
The validation check from the configuration validation section runs on startup and can be triggered manually.

# Coding and implementation behavior

When helping with implementation:
- prefer readable, explicit code over clever abstractions
- prefer config-driven behavior over hardcoded business logic
- keep route handlers thin
- separate services, repositories, and integrations
- isolate third-party API code from domain logic
- always make business scope explicit
- assume more businesses will be added later
- document external API contracts in docs/ as they are implemented (Retell payload schema, GHL endpoints, Cal.com endpoints)

Use explicit business-scoped function signatures.

Bad:
- createBooking(data)

Good:
- createBookingForBusiness(businessId, callerPhone, requestedSlot, eventTypeId)

Request context pattern: every function call handler creates a context object at entry:
```
{ callId, businessId, functionName, startTime: Date.now(), callerPhone }
```
Pass this through all service and integration calls. Use it for structured logging (call_id, business_id, function_name, duration_ms, status on every log). Compute duration_ms at the end of every function execution.

# Working style

When helping me build:
1. inspect the current structure first
2. explain the approach briefly
3. identify the files to create or change
4. implement in small steps
5. suggest relevant tests or checks
6. summarize what changed and what remains

If something is ambiguous, ask before making major architectural assumptions.
Do not silently choose architecture changes.
Do not overengineer V1.
Do not prematurely build V2-only infrastructure.
If a requested change risks cross-business leakage, stop and warn first.

# Pre-build validation (Step 0)

Before writing production code, validate these assumptions against real APIs:

0. Write and test Retell agent system prompt:
   - Write the full system prompt for the first pilot business
   - Test with 10+ simulated calls covering all 7 intents
   - This will surface conversation flow problems that change backend function signatures
   - Do this BEFORE building backend plumbing

1. Retell normal agent capability test:
   - Create a throwaway agent with 3-4 dummy functions
   - Test: Can you force function ordering (lookup before cancel)?
   - Test: Can you trigger disambiguation questions and route on answers?
   - Test: 9 custom function support
   - Test: Does the agent reliably use KB for static answers and backend functions for state changes?
   - Test: Confirm function call authentication mechanism (signature verification, shared secret, or other). If Retell doesn't sign function calls, determine alternative auth (IP allowlisting, custom header, etc.)
   - If orchestration control is insufficient: reassess conversation flow complexity or consider Custom LLM WebSocket
   - Document findings in docs/retell-api-contract.md

2. Cal.com API spike:
   - Document actual endpoints for availability query and booking create/cancel
   - Test: multi-event-type availability query for one business
   - Test: timezone handling in slot responses
   - Decide: who converts natural language dates ("tomorrow afternoon") to structured date ranges — Retell's agent or the backend? Document the decision.
   - Define check_availability and create_booking function signatures with real API shapes
   - Test: booking conflict (409) response format
   - Document in docs/calcom-api-contract.md

3. GHL API spike:
   - Test: phone-based contact search within a location
   - Document actual rate limits
   - Test: note creation and update flow (need note ID for post-Opus update)
   - Document auth method, token expiry, refresh mechanism, and 401 handling. If using OAuth2, build token refresh into the GHL integration module.
   - Document in docs/ghl-api-contract.md

# Build priority

If building from scratch, use this order:
1. backend skeleton (Node.js + TypeScript + Prisma + Railway config)
2. database schema
3. business resolver
4. Retell function entrypoint + webhook auth
5. Cal.com integration
6. GHL integration
7. memory layer
8. call logs + usage tracking
9. error handling + graceful degradation
10. Opus post-call processing
11. KB generation workflow
12. config validation
13. onboarding seed scripts
14. test suite (resolver, isolation, services)
15. health check endpoint
16. optional V2 research paths

# V2 research paths (do not build in V1)

See v2-research.md for the full list. Do not build any V2 features in V1.

# Decision log

See decisions.md for the full decision log with rationale.

Key principles: no KVKK/GDPR V1, no billing V1, no staging V1, no spam filtering V1, backend handles all scheduling (no Retell built-in tools), Opus never blocks CRM, agent operates 24/7 with identical behavior at all times, operating_hours is informational only.

# Definition of success

The project is successful when:
- multiple businesses run from one shared system
- each business feels isolated and customized
- the correct number reaches the correct agent
- the correct business config is always used
- the correct calendar is always used
- the correct CRM location is always used
- memory is business-scoped
- errors are handled gracefully with caller-friendly fallbacks
- Opus improves quality without slowing normal calls unnecessarily
- webhook requests are authenticated
- new businesses can be onboarded mostly through config, not custom code
- critical paths have test coverage
- all calls are logged with usage data for future pricing decisions
