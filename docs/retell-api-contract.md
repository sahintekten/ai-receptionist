# Retell API Contract

Extracted from `src/routes/retell.ts`, `src/lib/validation.ts`, `src/middleware/auth.ts`.

## Webhook Endpoint
- **URL:** `POST /retell/`
- **Purpose:** Single entrypoint for all Retell custom function calls

## Authentication
- **Header:** `X-Retell-Signature`
- **Verification:** `Retell.verify(rawBody, apiKey, signature)` from `retell-sdk`
- **API Key:** `RETELL_API_KEY` env variable
- **Raw body:** `JSON.stringify(req.body)` — must be the serialized body string, not parsed object
- **Failure:** 401 response + structured log

## Request Format

```json
{
  "name": "check_availability",
  "args": { "dateRange": "2026-04-01", "serviceType": "obezite" },
  "call": {
    "call_id": "call_abc123",
    "agent_id": "agent_xyz789",
    "from_number": "+905551234567",
    "to_number": "+908501234567",
    "call_type": "inbound",
    "direction": "inbound",
    "metadata": {}
  }
}
```

## 8 Function Names & Args Schemas

| Function | Args | Description |
|----------|------|-------------|
| `check_availability` | `dateRange?` (string), `serviceType?` (string) | Query Cal.com slots |
| `create_booking` | `callerPhone` (string), `slot` (string), `eventTypeId` (string\|number), `callerName?` (string) | Create Cal.com booking |
| `cancel_booking` | `bookingId` (string), `callerPhone` (string) | Cancel booking (requires prior lookup) |
| `lookup_bookings` | `callerPhone` (string), `name?` (string), `dateHint?` (string) | Search existing bookings (max 3) |
| `take_message` | `callerPhone` (string), `messageText` (string), `callerName?` (string), `type` ("message"\|"callback"\|"urgent") | Write CRM note |
| `get_caller_memory` | _(placeholder)_ | Read caller memory |
| `get_business_hours` | _(placeholder)_ | Return operating hours |
| `get_emergency_info` | _(placeholder)_ | Return emergency info |

## Response Format

**Always HTTP 200** — even on errors. Retell expects 200.

### Success Response
```json
{
  "result": "success",
  "slots": [...],
  "eventTypeId": 5194133,
  "total_slots": 18
}
```

### Error Response
```json
{
  "result": "error",
  "user_message": "Geçici bir sorun yaşıyorum efendim, mesajınızı alayım size dönüş yapalım."
}
```

### Conflict Response (booking)
```json
{
  "result": "conflict",
  "user_message": "Bu randevu slotu az önce doldu efendim. Müsait başka slotlara bakayım hemen."
}
```

## Error Handling

| Error Type | Response | Log Status |
|------------|----------|------------|
| `BusinessNotFoundError` | Friendly message, keep going | `business_not_found` |
| `LookupRequiredError` | Ask to look up bookings first | `lookup_required` |
| `IntegrationError` (409) | Slot conflict message | `conflict` |
| `AppError` | Generic friendly fallback | `error` |
| Unknown error | Generic friendly fallback | `unexpected_error` |

All `user_message` values are in **Turkish** (business language for Tekten Klinik).

## Backend Safety Nets

1. **Lookup required:** `cancel_booking` rejected if no prior `lookup_bookings` for this `call_id`. Tracked via in-memory Map.
2. **Phone required:** `create_booking`, `cancel_booking`, `lookup_bookings`, `take_message` require a valid `callerPhone`. Returns friendly message if missing.
3. **Booking ownership:** Verified by `businessId + callerPhone` match before cancel/reschedule.

## Request Processing Pipeline

1. Verify `X-Retell-Signature` (middleware)
2. Validate body with `RetellFunctionCallSchema` (Zod)
3. Extract `call_id`, `agent_id`, `from_number`
4. Resolve business from `agent_id` → `businessResolver`
5. Create request context `{ callId, businessId, functionName, startTime, callerPhone }`
6. Dispatch to function handler
7. Log: `call_id`, `business_id`, `action`, `duration_ms`, `status`
8. Return result (always 200)

## Known Limitations & Gotchas
1. **Always return 200** — Retell expects 200 for all function call responses. Errors communicated via `result` field.
2. **user_message in business language** — Turkish for Tekten. Must match agent's conversation language.
3. **Raw body for signature** — `JSON.stringify(req.body)` used for verification. If body parsing changes, verification breaks.
4. **In-memory lookup tracker** — `cancel_booking` safety net uses in-memory Map. Clears after 10K entries. Not persistent across restarts.
5. **10s timeout** — inherited from integration layer. Retell has its own timeout with filler speech.
