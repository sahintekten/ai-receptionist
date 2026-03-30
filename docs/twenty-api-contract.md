# Twenty CRM API Contract

Verified via live API spike on 2026-03-30.

## Base URL & Auth
- **Base URL:** `https://api.twenty.com`
- **Auth:** `Authorization: Bearer <API_KEY>` on every request
- **Content-Type:** `application/json`
- **Rate limit:** 100 requests/minute

## Response Wrapper Patterns

| Operation | HTTP | Response Wrapper |
|-----------|------|------------------|
| List people | GET `/rest/people` | `data.people[]` + `totalCount` + `pageInfo` |
| Get person | GET `/rest/people/:id` | `data.person` |
| Create person | POST `/rest/people` | `data.createPerson` |
| Update person | PATCH `/rest/people/:id` | `data.updatePerson` |
| Create note | POST `/rest/notes` | `data.createNote` |
| Update note | PATCH `/rest/notes/:id` | `data.updateNote` |
| Create noteTarget | POST `/rest/noteTargets` | `data.createNoteTarget` |

## Person Object

```json
{
  "id": "uuid",
  "name": { "firstName": "Ali", "lastName": "Yılmaz" },
  "phones": {
    "primaryPhoneNumber": "5559999999",
    "primaryPhoneCallingCode": "+90",
    "primaryPhoneCountryCode": "TR",
    "additionalPhones": []
  },
  "emails": { "primaryEmail": "", "additionalEmails": [] },
  "city": "",
  "jobTitle": "",
  "companyId": null,
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

### Phone Field Structure
- `primaryPhoneNumber`: local number without calling code (e.g. "5559999999")
- `primaryPhoneCallingCode`: international prefix (e.g. "+90")
- `primaryPhoneCountryCode`: auto-resolved ISO code (e.g. "TR")
- When creating: send `primaryPhoneNumber` + `primaryPhoneCallingCode`, country code is auto-resolved

## Note Object

```json
{
  "id": "uuid",
  "title": "Arama Notu",
  "bodyV2": {
    "blocknote": "[{...}]",
    "markdown": "Note content in markdown"
  },
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

### bodyV2 (RICH_TEXT)
- **Input:** `{"markdown": "content"}` — Twenty auto-generates blocknote JSON
- **Output:** both `blocknote` (JSON string) and `markdown` (string)
- **There is NO `body` field** — it was replaced by `bodyV2`

## Note → Person Linking (noteTarget)

Two-step process:
1. Create note: `POST /rest/notes`
2. Create noteTarget: `POST /rest/noteTargets` with `noteId` + `targetPersonId`

```json
// POST /rest/noteTargets
{
  "noteId": "note-uuid",
  "targetPersonId": "person-uuid"
}

// Response: data.createNoteTarget
{
  "id": "uuid",
  "noteId": "note-uuid",
  "targetPersonId": "person-uuid",
  "targetCompanyId": null,
  "targetOpportunityId": null
}
```

## Phone Search — CRITICAL LIMITATION

**Filtering on composite fields (phones, name) does NOT work in Twenty REST API.**

`filter[phones.primaryPhoneNumber][eq]=X` returns ALL records — the filter is silently ignored.

**Workaround:** Fetch people with pagination and filter client-side. At pilot volume (<100 contacts per workspace), this is acceptable. For scale, Twenty GraphQL API may support composite field filtering.

## Pagination

```json
{
  "totalCount": 6,
  "pageInfo": {
    "startCursor": "base64...",
    "endCursor": "base64...",
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

Use `?limit=N` for page size, `?starting_after=cursor` for pagination.

## Gotchas
1. Note body field is `bodyV2` not `body`
2. Phone filters on composite fields are silently ignored
3. Create response wrapper uses camelCase verb: `createPerson`, `createNote`, `createNoteTarget`
4. Update response wrapper: `updatePerson`, `updateNote`
5. List response wrapper: plural noun `people`, `notes`, `noteTargets`
