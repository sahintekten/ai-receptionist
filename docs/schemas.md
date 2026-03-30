# Database Schemas

## Business Config — Two-Table Pattern

### businesses table
- id, name, language, timezone, operating_hours (jsonb), greeting_text, closing_text, filler_speech, fallback_message, degradation_mode (message | callback), language_mismatch_action (message_take | generic_fallback | hang_up), urgent_escalation_config (jsonb), phone_number, retell_agent_id, kb_reference, enabled_intents (jsonb array), created_at, updated_at, is_active

urgent_escalation_config: `{ situations: [...], notify_contact: "+90...", response_time_promise: "30 minutes", escalation_message: "..." }`

operating_hours (split-shift, informational only — for answering "what are your hours?"): `{ monday: [{ open: "09:00", close: "12:00" }, { open: "13:00", close: "17:00" }], sunday: [] }`
Empty = closed that day. Times in business timezone. No holiday model V1. Does not affect agent behavior — agent operates 24/7.

### integration_configs table
- id, business_id (FK), integration_type (enum: calcom | ghl _(deprecated, kept for backward compat)_ | twenty | retell | anthropic), config_json (jsonb), is_enabled, created_at, updated_at
- calcom config: { event_types: [{ id, name, duration_minutes, service_type }], availability_mode, gcal_calendar_id? }
- twenty config: { api_key: "..." }
- retell config: { agent_id, webhook_url }
- anthropic config: { model_id, max_tokens, temperature }

## call_logs table
- id, call_id (unique), business_id (FK), agent_id, caller_phone (E.164)
- started_at, ended_at, duration_seconds
- disposition: completed | interrupted | failed | no_answer
- last_step: greeting | intent_detection | availability_check | booking | cancellation | rescheduling | message_taking | emergency | followup | closing
- detected_intent, raw_transcript, opus_summary, booking_id, message_text
- post_processing_status: pending | completed | failed | skipped
- opus_failure_reason, orphaned_booking_flag (bool)
- crm_write_status: success | failed | skipped
- crm_note_id (nullable, for CRM note dedup — stored after first successful note write, checked before retry/update)
- raw_phone (original format)
- Indexes: business_id+created_at, call_id (unique), business_id+caller_phone

## caller_memory table
- id, business_id (FK), caller_phone (E.164), raw_phone
- caller_name, last_call_id (FK), last_call_at
- recent_appointment_status, recent_message_summary, metadata_json (V2)
- UNIQUE(business_id, caller_phone)

## usage_tracking
No separate table V1. Derived from call_logs. Index: business_id+created_at.
