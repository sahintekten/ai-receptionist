# Knowledge Base (KB) Workflow

## V1: Manual Workflow

KB management is fully manual in V1. No automated KB generation or sync.

### KB Location
- Each business has a Retell agent with a linked Knowledge Base
- KB is stored in Retell platform (not in our database)
- `kb_reference` field in `businesses` table stores the Retell KB ID for reference

### KB Content Structure
- Clinic info (name, address, phone, hours)
- Doctor profiles (specialties, procedures)
- Service descriptions
- FAQ section
- Emergency info
- Cancellation/policy info

See `docs/tekten-klinik-kb.md` for the pilot business KB as reference.

### KB Update Workflow

```
1. Identify update needed (new service, changed hours, new FAQ, etc.)
2. Draft updated KB content (text document)
3. Human review — verify accuracy with business owner
4. Upload to Retell agent KB via Retell dashboard
5. Test with a test call — verify agent uses updated info correctly
6. Log the update (date, what changed, who approved)
```

### V2 Possibilities (Not Built)
- Opus-assisted KB draft generation from call transcripts (detect repeated questions not in KB)
- Automated KB gap detection in post-call pipeline
- API-driven KB upload via Retell API
- Version control for KB content

### Pilot Business KB
- **Tekten Klinik:** `docs/tekten-klinik-kb.md`
- **Retell KB ID:** `knowledge_base_6e573cce7789f481`
- **Retell Agent ID:** `agent_9d7537bb6f6966aee6af1a73ce`
