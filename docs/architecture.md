# Architecture Decisions

## Business Resolver Pipeline
Resolution order: agent_id → business metadata → telephony mapping → fallback
- agent_id is the primary key from Retell function calls
- telephony mapping is fallback for inbound-only scenarios
- never return a default business; fail explicitly if unresolved

## Database Tenancy
- One shared PostgreSQL, business_id on all tenant tables
- App-layer isolation via repository pattern (every query filtered by businessId)
- Schema designed for future RLS (business_id indexed, no cross-tenant joins)
- Prisma manages all migrations

## Model Strategy
- Fast live model for conversation (GPT-4.1 candidate for English, TBD for Turkish)
- Opus only for judgment tasks (post-call async by default, rare in-call sync)
- Model selection configurable per language in business config
- Never hardcode model names; use config mapping

## Retell Mode
- Normal Retell agents with conversation flow + KB + platform call controls
- Backend custom functions for all state-changing operations (no Retell built-in Cal.com tools)
- NOT Custom LLM WebSocket for V1

## Calendar Topology
- Single Cal.com account, per-business event types
- Availability mode per business config: Cal.com only OR Cal.com + GCal sync
- Backend always queries Cal.com regardless of upstream mode

## CRM Topology
- One GHL agency account, one location per business
- Every call writes to CRM (not just booked calls)
- Contact dedup by phone number within business location
- V1: contact + notes only, no pipeline

## Memory Design
- Scoped by business_id + caller phone number
- Light operational data only: name, phone, last contact, recent status
- Current confirmed call data overrides stored memory
- No deep personality memory in V1

## Deployment
- Single Railway service, auto-deploy on main push
- Railway PostgreSQL plugin for database
- All secrets in Railway environment variables
- No staging environment in V1
- Railway built-in logs + /health endpoint

## Business Config Schema
Two-table pattern:
- `businesses` table: core identity (name, language, timezone, hours, greeting texts, fallback config, phone, agent_id, kb_ref, enabled_intents)
- `integration_configs` table: business_id + integration_type (enum) + config_json (jsonb) + is_enabled
- Integration types: calcom, ghl, retell, anthropic
- Config validation checks both tables at startup

## Data Retention
- V1: no automatic deletion or expiry
- All call logs, memory, CRM data retained indefinitely
- Monitor DB growth during pilot
- Retention policies deferred to V2 based on actual volume

## Pricing
- V1 is free pilot
- Usage tracking enabled from day one for future pricing analysis
- Track: call volume, duration, Opus usage, bookings, CRM writes per business
