# GHL (GoHighLevel) Original Specification — Archived

> This file preserves the original GHL CRM specification from the initial V1 design.
> GHL was replaced by Twenty CRM before V1 implementation. See docs/twenty-api-contract.md.
> Kept for reference if reverting to GHL is ever needed.

---

## Integration Details (from docs/integrations.md)

- One agency account, one location per business
- Every call writes: contact + notes (phone, name, summary, disposition, booking outcome, message)
- Contact dedup: search by phone in business location → update if exists, create if not
- CRM note dedup: store ghl_note_id in call_logs after first successful write. Check before retry/update to prevent duplicate notes.
- CRM write retry: 1 attempt on failure, then log and continue
- V1: direct API writes, no pipeline, no workflow triggers
- All writes go to correct business location (business_id → GHL location_id mapping)
- Token lifecycle: document during GHL spike — auth method (API key vs OAuth2), token expiry, refresh mechanism, 401 handling. If OAuth2, build token refresh into integration module.

### API Keys
- GHL API key / OAuth tokens (agency-level, per-location access)
- Environment variable: GHL_API_KEY

---

## CRM Strategy (from docs/project-instruction.md)

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

### GHL Contact Deduplication
Use phone number as the primary match key.

For every call:
1. search for existing contact by phone number in the business location
2. if found, update the existing contact with new call data
3. if not found, create a new contact

Do not create duplicate contacts for the same phone number within a business location.

### GHL CRM Note Deduplication
Store `ghl_note_id` in call_logs after the first successful CRM note write.
Before writing or retrying a CRM note, check if `ghl_note_id` is already populated for this call_id.
If yes, update the existing note instead of creating a new one.
This prevents duplicate CRM notes from retries or timeout-then-success scenarios.

### GHL Config (integration_configs)
```json
{ "location_id": "...", "contact_search_enabled": true }
```

---

## GHL Topology (from docs/project-instruction.md)

GoHighLevel is the CRM system for:
- contacts
- notes

One agency account, one location per business. Business-level isolation via location_id.

---

## Decisions (from docs/decisions.md)

- No pipeline in V1: contact + notes sufficient, pipeline adds complexity without V1 value
- crm_write_status field in call_logs: tracks CRM write success/failure/skip per call
- GHL token lifecycle must be documented during spike: auth method, token expiry, refresh mechanism, 401 handling

---

## Error Handling (from docs/error-handling.md)

- GHL contact/note write: 1 retry (idempotent with phone dedup)
- Post-call pipeline: no transaction boundary across PostgreSQL + GHL
- Accept eventual consistency

---

## Onboarding (from docs/onboarding.md)

- Step 5: Create GHL location for the business in the agency account
- Step 8: Add GHL location ID to business config in database

---

## Conversation Flow (from docs/conversation-flow.md)

- Message Taking Flow step 4: "Backend: write to GHL note + call log"

---

## API Spike (from docs/project-instruction.md)

GHL API spike items:
- Test: phone-based contact search within a location
- Document actual rate limits
- Test: note creation and update flow (need note ID for post-Opus update)
- Document auth method, token expiry, refresh mechanism, and 401 handling
- Document in docs/ghl-api-contract.md
