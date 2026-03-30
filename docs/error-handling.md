# Error Handling and Resilience

## Timeout Behavior
- Retell plays business-configurable filler speech while backend processes ("One moment...")
- If function exceeds timeout: deliver business-configurable fallback message
- Log: call_id, function name, duration, timeout flag

## Graceful Degradation
Per business config, when a downstream service is unavailable:
- **Option A — Message mode**: "I'm unable to book right now, but I can take a message"
- **Option B — Callback promise**: "We're experiencing a temporary issue, someone will call you back"
- Every degraded call logged with: failure reason, fallback path taken, affected service

## Retry Rules by Integration

| Integration | Retry | Reason |
|---|---|---|
| Cal.com booking (create) | NO | Double booking risk |
| Cal.com availability (read) | 1 retry | Safe to retry reads |
| CRM contact/note write (Twenty) | 1 retry | Idempotent with phone dedup |
| Memory read/write (PostgreSQL) | 1 retry | Transient DB errors |
| Opus in-call (sync) | NO | Timeout to fallback instead |
| Opus post-call (async) | 1 retry | Non-blocking, can afford retry |

All retries logged with attempt count and final status.

## Concurrent Booking
- Cal.com handles slot-level conflict detection
- First booking succeeds, second gets conflict response (409)
- Backend catches conflict → tells caller "slot just taken" → re-queries availability → offers alternatives
- No backend-level booking locks in V1
- Log every conflict: call_id, business_id, requested_slot, conflict_reason

## Reschedule Failure Handling
Reschedule = create new booking first, then cancel old.
- If new booking fails: old booking preserved. Caller informed, offered alternatives.
- If new booking succeeds but old cancel fails: temporary double booking. Flag for human review. Opus post-call can also detect this.
- Never cancel old before new is confirmed.

## Webhook Idempotency
Use `INSERT ... ON CONFLICT (call_id) DO NOTHING` and check affected row count.
- If 0 rows inserted: duplicate webhook — return 200, skip pipeline, log duplicate.
- If 1 row inserted: proceed with post-call pipeline.
- Do NOT use SELECT-then-INSERT — race condition when two identical webhooks arrive simultaneously.

## CRM Note Deduplication
Store `crm_note_id` in call_logs after first successful CRM note write.
Before writing or retrying a CRM note, check if `crm_note_id` is already populated for this call_id. If yes, update instead of create. Prevents duplicate CRM notes from retries or timeout-then-success scenarios.

## Interrupted Calls
When caller hangs up mid-conversation:
1. Log call: disposition = interrupted, last completed step recorded
2. If booking request was sent to Cal.com but not confirmed to caller:
   - Flag for post-call Opus review
   - Opus checks if orphaned booking exists
   - Result logged, NOT auto-cancelled
   - Human reviews flagged bookings

## Spam/Robocall (V1)
- No filtering in V1
- All calls processed by Retell
- Duration and patterns logged for future analysis
- V2: short-call detection, repeat-caller throttling

## Post-Call Pipeline Failure Combinations

Each step can fail independently. Accept eventual consistency — no transaction boundary across PostgreSQL + CRM:

- If call log write fails: retry 1x, then drop (rare, DB issue). Pipeline stops.
- If memory write fails after call log succeeds: retry 1x, log inconsistency. Continue to CRM write.
- If CRM write fails after memory succeeds: retry 1x, track via crm_write_status. Continue to Opus.
- If Opus fails: keep basic CRM note from step 3, log opus_failure_reason. Pipeline ends gracefully.
- If Opus succeeds but CRM update fails: retry 1x, log. Basic note from step 3 survives.
- If initial CRM write failed (crm_write_status = failed) and Opus completes: Opus creates a new CRM note rather than updating. Log the recovery.
