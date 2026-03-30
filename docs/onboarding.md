# Business Onboarding

## V1 Onboarding Process (Manual)

### Steps
1. Collect business info: name, address, hours, services, providers, language, urgent escalation contact
2. Create business record in PostgreSQL (seed script or direct SQL)
3. Create Retell agent with business-specific conversation flow and KB
4. Assign phone number to agent in Retell
5. Create Twenty workspace for the business + generate API key
6. Create Cal.com event types for the business (per service/provider)
7. Configure availability mode (Cal.com only or Cal.com + GCal sync)
8. Add business config to database:
   - agent_id → business_id mapping
   - phone_number → business_id mapping
   - Cal.com event type IDs
   - Twenty API key
   - language and model config
   - operating hours
   - fallback behavior (message mode or callback mode)
   - filler speech and fallback messages
9. Run config validation (startup validator or manual trigger)
10. Perform test call via Retell test feature
11. Verify: correct greeting, correct KB responses, booking flow works, CRM write works, memory works
12. Go live

### Config Validation Checks
- agent_id mapped and not duplicate
- phone number mapped and not duplicate
- Cal.com event type exists and is accessible
- Twenty API key valid
- KB reference present
- Language and model config valid
- Operating hours defined
- Fallback behavior configured
- No conflicting mappings across businesses

### V1 Tooling
- Onboarding seed script: takes a JSON config file and automates steps 2, 7, 8 (creates business record, adds integration configs, runs config validation). Manual steps (Retell agent, Twenty workspace, Cal.com event types) remain manual in V1.
- Direct SQL for ad-hoc fixes
- Railway env vars for secrets
- Retell outage notification: developer monitors Retell status page and contacts businesses manually (WhatsApp/phone)
- No admin panel (V2 candidate)
