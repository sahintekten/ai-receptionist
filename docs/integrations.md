# Integration Details

## Retell AI
- Normal agents with conversation flow + KB + backend custom functions
- KB handles static info (hours, services, FAQs). Backend handles all state-changing operations.
- Single backend entrypoint receives all function calls
- Webhook authentication: must be confirmed during pre-build spike. Options: signature verification, shared secret header, IP allowlisting. Document in retell-api-contract.md.
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

> **V1 Update:** GHL replaced by Twenty CRM for V1. See `docs/twenty-api-contract.md` for API details.

## GoHighLevel (GHL) _(replaced by Twenty CRM in V1)_
- One agency account, one location per business
- Every call writes: contact + notes (phone, name, summary, disposition, booking outcome, message)
- Contact dedup: search by phone in business location → update if exists, create if not
- CRM note dedup: store crm_note_id in call_logs after first successful write. Check before retry/update to prevent duplicate notes.
- CRM write retry: 1 attempt on failure, then log and continue
- V1: direct API writes, no pipeline, no workflow triggers
- All writes go to correct business location (business_id → GHL location_id mapping)
- Token lifecycle: document during GHL spike — auth method (API key vs OAuth2), token expiry, refresh mechanism, 401 handling. If OAuth2, build token refresh into integration module.

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
- GHL API key / OAuth tokens (agency-level, per-location access)
- Anthropic API key (global)
- Database connection string (Railway)
- Webhook shared secret (for Retell auth)

## Environment Variables
```
RETELL_API_KEY        # Retell platform API key
CALCOM_API_KEY        # Cal.com API key
GHL_API_KEY           # GoHighLevel API key or OAuth token
ANTHROPIC_API_KEY     # Anthropic API key for Opus
DATABASE_URL          # PostgreSQL connection string (Railway provides)
WEBHOOK_SECRET        # Shared secret for Retell webhook auth
PORT                  # Server port (Railway sets automatically)
NODE_ENV              # production | development
LOG_LEVEL             # info | debug | warn | error
```

All stored in Railway environment variables. Rotation procedure documented separately.
