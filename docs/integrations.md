# Integration Details

## Retell AI
- Normal agents with conversation flow + KB + backend custom functions
- KB handles static info (hours, services, FAQs). Backend handles all state-changing operations.
- Single backend entrypoint receives all function calls
- Webhook authentication: X-Retell-Signature header, verified via retell-sdk Retell.verify()
- Reject unauthenticated requests and log them
- Webhook idempotency: INSERT ON CONFLICT (call_id) DO NOTHING — race-free, no SELECT-then-INSERT

## Cal.com
- Single Cal.com account, per-business event types (1:N per business)
- Availability mode per business: Cal.com only OR Cal.com + GCal sync
- Backend queries Cal.com for availability (always)
- ALL scheduling operations go through backend functions — NO Retell built-in Cal.com tools in V1
- Reason: ensures consistent CRM writes, memory updates, logging, and business-scoped validation
- Booking operations: NO retry (double booking risk)
- Booking conflict (Cal.com 409): re-query availability, offer alternatives

## Twenty CRM
> Originally GHL — see docs/archive/ghl-original-spec.md

- Base URL: `https://api.twenty.com`
- Auth: `Authorization: Bearer <API_KEY>` per workspace
- One Twenty workspace per business (workspace-level isolation)
- API key per workspace stored in `integration_configs.config_json`
- Core objects: People (contacts), Notes, NoteTargets
- Every call writes: contact + notes (phone, name, summary, disposition, booking outcome, message)
- Contact dedup: search by phone (client-side filter — composite fields not filterable in REST API), update if exists, create if not
- Note creation flow: create note (bodyV2 with markdown) → create noteTarget to link note to person
- CRM note dedup: store `crm_note_id` in call_logs after first successful write. Check before retry/update.
- CRM write retry: 1 attempt on failure, then log and continue
- V1: direct API writes, no pipeline, no workflow triggers
- Rate limits: 100 requests/minute
- See `docs/twenty-api-contract.md` for full API details

## Anthropic Opus
- Post-call processing: async by default
  - Trigger: Retell call.completed webhook
  - Input: full transcript + call metadata (business_id, caller_phone, disposition, intents)
  - Output: structured summary, enriched CRM note, orphaned_booking flag
  - Pipeline: call log write → memory write → basic CRM note → Opus async → update call log + CRM note
  - Steps 1-3 are sync (fast). Opus steps are async.
  - If Opus fails: keep basic CRM note from pre-Opus step, log failure, continue
  - Opus memory update guarded by last_call_id: only update memory if last_call_id still matches. If a newer call has already updated, skip Opus memory write for the stale call.
  - KB gap detection is V2 (not in post-call pipeline)
- In-call: rare, synchronous, with timeout + fallback
- Post-call retry: 1 attempt
- In-call retry: none (timeout to fallback message)
- Never block CRM writes on Opus success

## API Keys to Manage
- Retell API key (global)
- Cal.com API key (global, per-business event types)
- Twenty API key (per workspace, stored in integration_configs)
- Anthropic API key (global)
- Database connection string (Railway)
- Webhook shared secret (for Retell auth)

## Environment Variables
```
RETELL_API_KEY        # Retell platform API key
CALCOM_API_KEY        # Cal.com API key
TWENTY_API_KEY        # Twenty CRM API key (local dev; production uses integration_configs)
ANTHROPIC_API_KEY     # Anthropic API key for Opus
DATABASE_URL          # PostgreSQL connection string (Railway provides)
WEBHOOK_SECRET        # Shared secret for Retell webhook auth
PORT                  # Server port (Railway sets automatically)
NODE_ENV              # production | development
LOG_LEVEL             # info | debug | warn | error
```

All stored in Railway environment variables. Rotation procedure documented separately.
