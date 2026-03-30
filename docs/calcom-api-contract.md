# Cal.com API Contract

Extracted from `src/integrations/calcom.ts`. Verified via live API spike on 2026-03-30.

## Base URL & Auth
- **Base URL:** `https://api.cal.com/v2`
- **Auth:** `Authorization: Bearer <CALCOM_API_KEY>`
- **Content-Type:** `application/json`
- **API version headers required** — different per endpoint group

## API Version Headers

| Endpoint Group | Header Value |
|----------------|-------------|
| Slots (availability) | `cal-api-version: 2024-09-04` |
| Bookings (CRUD) | `cal-api-version: 2024-08-13` |

## Endpoints Used

### GET /v2/slots — Available Slots (Availability)

**Query Parameters:**
- `eventTypeId` (number, required)
- `start` (ISO 8601 UTC, required)
- `end` (ISO 8601 UTC, required)
- `timeZone` (string, default: "Europe/Istanbul")
- `format` ("range" — returns start + end per slot)

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "2026-03-31": [
      { "start": "2026-03-31T14:30:00.000+03:00", "end": "2026-03-31T15:00:00.000+03:00" }
    ]
  }
}
```

**Retry:** 1 retry allowed (safe read)

### POST /v2/bookings — Create Booking

**Request Body:**
```json
{
  "eventTypeId": 5194133,
  "start": "2026-03-31T14:30:00.000+03:00",
  "attendee": {
    "name": "Ali Yılmaz",
    "email": "caller_905551234567@phone.aireceptionist.local",
    "timeZone": "Europe/Istanbul"
  },
  "location": { "type": "phone", "value": "+905551234567" },
  "metadata": { "source": "ai-receptionist" }
}
```

**Response (201):**
```json
{
  "status": "success",
  "data": {
    "id": 123,
    "uid": "booking_uid_123",
    "title": "Obezite Ön Görüşme",
    "start": "2026-03-31T14:30:00Z",
    "end": "2026-03-31T15:00:00Z",
    "status": "accepted",
    "attendees": [{ "name": "Ali Yılmaz", "email": "...", "timeZone": "Europe/Istanbul" }],
    "hosts": [{ "name": "Dr. Güneş Tekten" }]
  }
}
```

**Retry:** NO — double booking risk

**Conflict (409):** Slot taken by another booking. Catch and re-query availability.

### POST /v2/bookings/{bookingUid}/cancel — Cancel Booking

**Request Body:**
```json
{
  "cancellationReason": "Arayan tarafından iptal edildi"
}
```

**Response (200):** Returns cancelled booking data.

**Retry:** 1 retry allowed

### GET /v2/bookings — List Bookings

**Query Parameters:**
- `attendeeEmail` (string) — filter by attendee
- `attendeeName` (string)
- `eventTypeId` (number)
- `status` (comma-separated: "upcoming", "past", "cancelled")
- `afterStart` (ISO 8601)
- `take` (number, default 100)
- `sortStart` ("asc" | "desc")

**Response (200):**
```json
{
  "status": "success",
  "data": [
    { "id": 123, "uid": "...", "title": "...", "start": "...", "end": "...", "status": "accepted", "attendees": [...], "hosts": [...] }
  ]
}
```

**Retry:** 1 retry allowed (safe read)

## Timezone Handling
- All availability queries use `Europe/Istanbul`
- Slots returned with timezone offset (e.g. `+03:00`)
- Booking start times sent in ISO 8601 with timezone

## Attendee Email
Cal.com requires an email for booking. We generate a deterministic placeholder:
`caller_{sanitizedPhone}@phone.aireceptionist.local`

## Retry Rules

| Operation | Retry | Reason |
|-----------|-------|--------|
| Get availability (slots) | 1 retry | Safe read |
| Create booking | NO | Double booking risk |
| Cancel booking | 1 retry | Safe to retry |
| List bookings | 1 retry | Safe read |

## Known Limitations & Gotchas
1. **Booking create has NO retry** — double booking risk. If it fails, surface error to caller.
2. **409 conflict** — means slot was taken between availability check and booking. Re-query and offer alternatives.
3. **API version headers required** — different versions for slots vs bookings endpoints. Missing header = error.
4. **Attendee email required** — we generate placeholder from phone number since callers don't provide email.
5. **10s timeout** — AbortController kills request after 10 seconds.
