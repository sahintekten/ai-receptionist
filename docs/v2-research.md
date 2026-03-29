# V2 Research Paths (Do Not Build in V1)

These are documented for future reference only:

## Conversation & Caller Experience
- Live call transfer to human (SIP transfer or warm handoff)
- SMS/email booking confirmation (Cal.com built-in or GHL workflow)
- Multi-language agent switching (in-call language detection)
- Outbound calling (appointment reminders, callback fulfillment)
- Batch cancellation with single confirmation
- Automated callback completion tracking
- Deep caller memory and personalization (preferred provider, time, recurring interest)

## CRM & Business Intelligence
- CRM pipeline tracking (Lead → Booked → Showed → No-show)
- Admin panel for business onboarding
- Billing and payment collection

## Infrastructure & Operations
- Separate staging environment (Railway staging branch)
- External log aggregator and alerting (Betterstack, Logflare, Slack)
- Deep health check (Retell + Cal.com + GHL API reachability)
- Secret manager migration (Doppler, Infisical)
- Tenant-based rate limits, throttling, or quotas

## Platform Features
- API-driven Retell agent provisioning (automated onboarding)
- Holiday calendar support in operating hours
- Business pause/resume with paused greeting
- Telco-level call forwarding on Retell outage
- Spam/robocall filtering (short-call detection, repeat-caller throttling)
