# Chat Reconciliation Regression Playbook

This playbook is the repeatable gate for the sandboxed Hermes One reconciliation work.
Run it after Hermes One changes, Hermes Agent engine updates, compatibility
addon changes, or remote/SSH lab changes.

## Scope

The goal is to verify that Hermes One uses the dashboard event stream as the
active-turn source of truth without losing behavior that existed in the legacy
desktop app:

- ordered assistant output, reasoning, tool calls, tool results, errors, and
  artifacts;
- restored sessions that match live sessions;
- successful continuation after restoring a session;
- recovery from failed provider turns;
- local, Remote HTTP, and SSH dashboard parity;
- legacy fallback still available where configured.

## Automated Gate

Run from the separate development worktree:

```powershell
cd C:\Users\pmos6\Documents\Claude\Projects\Hermes-Desktop-reconcile

npm run typecheck
npm test -- --run tests/remote-sessions.test.ts tests/remote-metadata.test.ts tests/remote-models.test.ts tests/dashboard-chat-transport.test.ts tests/dashboard-event-adapter.test.ts tests/live-tool-events.test.ts tests/live-reasoning-events.test.ts tests/tool-activity-group-title.test.ts tests/reconcile-streamed-with-db.test.ts tests/session-history-mapping.test.ts tests/sessions-history-items.test.ts tests/sessions-decode-content.test.ts src/renderer/src/screens/Chat/mediaUtils.test.ts src/renderer/src/screens/Chat/hooks/useChatIPC.test.tsx tests/chat-messages.test.ts tests/session-continuation-store.test.ts tests/dashboard-remote.test.ts tests/dashboard-launch.test.ts tests/dashboard-gateway-client.test.ts tests/hermes-agent-compat.test.ts tests/run-stream.test.ts src/renderer/src/screens/Sessions/Sessions.test.tsx
```

Expected result:

- TypeScript node and web checks pass.
- All listed test files pass.

When time permits, also run the entire suite:

```powershell
npm test -- --run
```

## Lab Setup

Start the disposable Remote HTTP target:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\remote-lab.ps1 up
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\remote-lab.ps1 status
```

Start the SSH tunnel lab:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ssh-lab.ps1 up
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ssh-lab.ps1 status
```

Start the sandboxed Hermes One instance:

```powershell
npm run dev:sandbox
```

Pass criteria:

- Remote status shows dashboard status, dashboard session auth, and legacy
  OpenAI models auth as OK.
- SSH status reaches the remote dashboard through the tunnel.
- Hermes One title bar says `Hermes One`.
- Settings shows the active connection mode and active chat transport.

## Connection Matrix

Run the manual cases below in these modes:

- Local, dashboard auto.
- Local, dashboard forced.
- Local, legacy fallback.
- Remote HTTP, dashboard auto.
- Remote HTTP, dashboard forced.
- Remote HTTP, legacy fallback.
- SSH, dashboard auto.
- SSH, dashboard forced.
- SSH, legacy fallback.

For auto modes, Settings should show the resolved active path. Switching between
Local, Remote HTTP, and SSH should refresh:

- model selector rows;
- Models page rows;
- Sessions page rows;
- Settings Hermes Agent metadata.

Remote HTTP and SSH should show models configured on the remote Hermes Agent
side, not the local desktop's model library.

## Manual Cases

### 1. Clean Text Turn

Prompt:

```text
Reply with exactly TEXT_OK and no tools.
```

Pass criteria:

- Streaming starts promptly.
- Final assistant message is present once.
- Restoring the session shows the user prompt and assistant answer once.

### 2. Bad Provider Then Recovery

Switch to a known-bad model/provider.

Prompt:

```text
Live regression bad provider turn. Reply with BAD_KEY_SHOULD_FAIL.
```

Then switch to a known-good model/provider in the same visible session.

Prompt:

```text
Live regression recovery after bad provider. Reply with exactly RECOVERY_AFTER_BAD_OK and do not mention BAD_KEY_SHOULD_FAIL. Do not use tools.
```

Pass criteria:

- Failed turn appears as an error in sequence.
- Good-provider recovery does not repeat the bad-provider error.
- Restored session keeps both user prompts, the error, and the recovery answer
  in order.
- Repeating failed/non-failed/failed/non-failed turns keeps every semi-session
  boundary in order.

### 3. Reasoning And Interleaved Output

Use a reasoning-heavy model such as DeepSeek V4 Pro.

Prompt:

```text
Think briefly, then answer in two short sentences. Mention the words FIRST and SECOND in separate sentences.
```

Pass criteria:

- Reasoning/thought blocks appear when the backend emits them.
- Intermediate assistant output stays in sequence with reasoning and tools.
- Restored session preserves reasoning blocks and assistant text order.

### 4. Tool-Heavy Image Generation

Use the AI Playground / ComfyUI skill.

Prompt:

```text
Generate an image of a toy duck in a bathtub using AI Playground / ComfyUI. Save it to the media folder if the workflow supports that, and show me the resulting file path.
```

Pass criteria:

- Tool calls and tool results stream in order when emitted.
- Sequential tool calls are grouped as `N tools called`.
- Inside each group, each tool call is paired with its matching result.
- Final answer does not duplicate the same image because of markdown/path
  parsing.
- Existing local Windows paths render as media when they exist.
- Remote/SSH paths under `/opt/data/images` render through the dashboard media
  endpoint.
- Restored session shows the same grouped calls/results and the same media.

### 5. Pasted Image Prompt

Paste an image into the prompt box.

Prompt:

```text
What is this?
```

Pass criteria:

- The user bubble appears once.
- The pasted image thumbnail appears in the user bubble.
- Hermes Agent fallback text such as `[The user attached an image but analysis failed.]`
  is not shown as user-visible prompt content.
- The same session restored from Sessions still shows the image thumbnail, not
  raw fallback text.
- Continuing the restored session does not duplicate the prior pasted-image
  prompt.

### 6. Remote Vision Tool

In Remote HTTP and SSH dashboard modes, ask about a known image using a text-only
chat model plus configured auxiliary vision.

Prompt:

```text
Use vision_analyze to describe the attached image in one short sentence.
```

Pass criteria:

- `vision_analyze` returns semantic visual content, not just pixel statistics.
- The remote lab resolves auxiliary vision to OpenRouter
  `google/gemini-3-flash-preview` when an OpenRouter key is available.

Optional container smoke test:

```powershell
docker exec hermes-two-remote-lab-agent sh -lc 'cd /opt/hermes && HERMES_HOME=/opt/data /opt/hermes/.venv/bin/python3 - <<\"PY\"
import asyncio
from tools.vision_tools import vision_analyze_tool
async def main():
    out = await vision_analyze_tool("/opt/data/images/duck_bathtub.png", "Describe this image in one short sentence.")
    print(out[:1200])
asyncio.run(main())
PY'
```

### 7. Session Search, Restore, Continue

For each connection mode:

1. Open Sessions.
2. Restore the newest session from that mode.
3. Verify the visible transcript matches the original live transcript.
4. Send:

```text
Continue this session with exactly CONTINUE_OK and no tools.
```

Pass criteria:

- Sessions list belongs to the active connection mode.
- Session restore does not mix local, Remote HTTP, and SSH sessions.
- Continuing a restored dashboard session does not produce `session not found`.
- Continuing does not write the remote/SSH session into local-only history.

## Known Upstream Limitations

- Gemini failures in the current lab have been traced to Hermes Agent upstream
  behavior, not Hermes One dashboard reconciliation.
- Plain Remote HTTP cannot be patched by Hermes One unless the target exposes a
  future deploy endpoint or is also reachable over SSH.
- The remote lab intentionally bridges to this Windows host's AI Playground
  ComfyUI for testing. That is not normal remote deployment behavior.

## Exit Criteria

Before asking for review or preparing a PR:

- Automated gate passes.
- Remote and SSH lab health checks pass.
- At least one dashboard-mode live pass succeeds for Local, Remote HTTP, and
  SSH.
- Legacy fallback is checked at least once after any change that touches legacy
  IPC or `/v1` paths.
- Any known failure is classified as Hermes One, Hermes Agent upstream, lab
  setup, or provider/service behavior.
