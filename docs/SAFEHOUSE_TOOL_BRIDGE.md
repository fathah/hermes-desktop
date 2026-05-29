# SafeHouse Tool Bridge

Hermes Desktop can call the SafeHouse Signal local Tool Bridge directly from chat.

Default bridge URL:

```text
http://127.0.0.1:57109
```

Optional override:

```bash
SAFEHOUSE_TOOL_BRIDGE_URL=http://127.0.0.1:57109 npm run dev
```

Only loopback HTTP(S) URLs are accepted. Remote bridge URLs are rejected so Desktop cannot accidentally send SafeHouse prompts or tool payloads to a non-local endpoint.

## Endpoints

- `GET /health`
- `GET /tools`
- `POST /tools/call`

Desktop uses `GET /health` and `GET /tools` to show bridge status and tool count in chat. SafeHouse-specific plain-English prompts are routed deterministically to `POST /tools/call`.

## Routed Prompts

- `Summarize SafeHouse platform health` -> `safehouse.platform.status`
- `Check API usage` -> `safehouse.api.usage.summary`
- `What agents are failing?` -> `safehouse.agent.operations.summary`
- `Check outbound queue` -> `safehouse.outbound.queue.summary`
- `Draft a playbook recommendation` -> `safehouse.playbook.draft.recommendation`
- `Can you replay failed queue items?` -> `safehouse.propose.queue.retry`
- `Can you run a migration?` -> `safehouse.block.migration`

Read-only routes call approved SafeHouse tools. Proposal-only routes return approval-required proposals. Blocked routes return policy blocks and never dispatch to Hermes or SafeHouse mutation paths.

## Security Boundary

- Desktop does not receive SafeHouse database credentials.
- Desktop does not receive Supabase service-role keys.
- Desktop does not store SafeHouse admin bearer tokens.
- Mutations remain blocked or proposal-only.
- The bridge must remain local-only.

If the bridge is unavailable, Desktop shows an unavailable bridge result instead of inventing SafeHouse platform state.
