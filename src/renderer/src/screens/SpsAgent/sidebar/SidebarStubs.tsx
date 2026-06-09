// SidebarStubs.tsx — Meetings / Shared / Apps sections. These are progressive-
// disclosure entry points: there is no native calendar/mail/collaboration layer
// yet, so each row routes to a guided Hermes chat (pre-filled prompt) that leans
// on the existing Calendar MCP + agent. All three sections default to OFF.
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import type { IconName } from "../components/iconPaths";

function StubRow({
  icon,
  label,
  prompt,
}: {
  icon: IconName;
  label: string;
  prompt: string;
}) {
  const startNewChat = useStore((s) => s.startNewChat);
  return (
    <button
      type="button"
      className="nav-item"
      onClick={() => startNewChat(prompt)}
      title={label}
    >
      <Icon name={icon} size={17} />
      <span className="nav-label">{label}</span>
    </button>
  );
}

export function SidebarMeetings() {
  return (
    <>
      <StubRow
        icon="calendar"
        label="Connect your calendar"
        prompt="Help me connect my Google Calendar so you can see my events and prep meeting notes for them."
      />
      <StubRow
        icon="sparkle"
        label="New AI meeting note"
        prompt="Start an AI meeting note: capture the agenda, take notes during the meeting, and summarise decisions and action items afterwards."
      />
    </>
  );
}

export function SidebarShared() {
  return (
    <StubRow
      icon="share"
      label="Start collaborating"
      prompt="Help me share a page or workspace with a teammate and set up collaboration."
    />
  );
}

export function SidebarApps() {
  return (
    <>
      <StubRow
        icon="send"
        label="Mail"
        prompt="Help me triage and draft replies to my email."
      />
      <StubRow
        icon="calendar"
        label="Calendar"
        prompt="Show me what's on my calendar today and help me plan my day."
      />
    </>
  );
}
