# Conversation Flow

## Call Direction
V1 is inbound only. No outbound calling.

## Supported V1 Intents
1. **Appointment booking** — check availability → suggest slot → confirm → create booking
2. **Appointment cancellation** — lookup existing booking → confirm cancellation → cancel
3. **Appointment rescheduling** — lookup existing → create new booking first → then cancel old (preserves original if new fails)
4. **General inquiry** — answer from KB (hours, address, services, pricing, providers, policies)
5. **Message taking** — capture caller's message → store in CRM note (type=message) → confirm to caller
6. **Urgent escalation** — detect urgency per business config → deliver soft escalation message → log via take_message(type=urgent)
7. **Follow-up scheduling** — caller asks about promised callback → check CRM/memory → respond or take_message(type=callback)

## Call Structure
1. Greeting (business-specific, language-specific, no AI disclaimer)
2. Intent detection
3. Intent routing
4. Action execution
5. Confirmation or fallback
6. Closing (business-specific)

## Edge Case Flows

### Simultaneous Intents
"Cancel and rebook" → AI asks: reschedule or cancel+book separately? Route based on caller's answer.

### Multiple Bookings (Cancel/Reschedule)
lookup_bookings returns max 3 results. Agent presents each by date + provider name for voice disambiguation. AI asks which one. No batch cancel in V1.

### Language Mismatch
Business config language_mismatch_action: message_take | generic_fallback | hang_up. Detect early, apply configured action.

### Caller Name Conflict (Shared Phone)
If caller provides a name, update memory. If not, keep existing name. Always prefer current call data.

### Repeat Caller Within Minutes
Memory is written immediately after call (before Opus). Safe for repeat callers.

## 24/7 Behavior
- Agent operates identically at all times — no after-hours mode
- All 7 intents available 24/7
- Same greeting always (no after-hours greeting)
- If no Cal.com slots available (any time of day), agent offers alternative dates or message taking
- Availability is driven by Cal.com data, not time-of-day rules

## Transfer to Human
- V1 does NOT support live call transfer
- If AI cannot resolve: take message → log as needing human follow-up → inform caller

## Booking Happy Path
1. Caller requests appointment
2. Agent asks for preferred date/time and service
3. Backend: check_availability for business event type(s)
4. Agent offers available slot(s)
5. Caller confirms
6. Backend: create_booking in Cal.com
7. Agent: verbal confirmation (date, time, provider)
8. Backend: CRM write + memory update

## Booking Fallback Paths
- No availability → offer alternative dates or message taking
- Cal.com down → graceful degradation per business config
- Booking conflict (409) → re-query, offer alternatives
- Caller hangs up mid-booking → log interrupted, Opus checks for orphaned booking

## Message Taking Flow
1. Agent: "I'll take a message for you"
2. Caller leaves message
3. Agent reads back summary for confirmation
4. Backend: write to CRM note + call log
5. Agent: closing
