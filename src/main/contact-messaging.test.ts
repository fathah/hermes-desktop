import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));

const vaultMocks = vi.hoisted(() => ({
  readRowMarkdownFrom: vi.fn(),
  exportRowMarkdownTo: vi.fn(),
  setNagRecord: vi.fn(),
}));

vi.mock("./sps-storage", () => ({
  resolveSpsVaultDir: vi.fn(() => "/vault"),
}));

vi.mock("./sps-vault", () => ({
  readRowMarkdownFrom: vaultMocks.readRowMarkdownFrom,
  exportRowMarkdownTo: vaultMocks.exportRowMarkdownTo,
}));

vi.mock("./tasks-dump", () => ({
  setNagRecord: vaultMocks.setNagRecord,
}));

import { buildHandoffUrl, openContactChannel } from "./contact-messaging";
import { shell } from "electron";
import type { ContactChannel } from "../shared/contacts";

const ch = (kind: ContactChannel["kind"], value: string): ContactChannel => ({
  kind,
  value,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildHandoffUrl", () => {
  it("builds mailto / sms / imessage / wa.me schemes", () => {
    expect(buildHandoffUrl(ch("email", "p@x.com"))).toBe("mailto:p@x.com");
    expect(buildHandoffUrl(ch("sms", "+91 98 765"))).toBe("sms:+9198765");
    expect(buildHandoffUrl(ch("imessage", "+91-98-765"))).toBe(
      "imessage:+9198765",
    );
    expect(buildHandoffUrl(ch("whatsapp", "+91 98765 43210"))).toBe(
      "https://wa.me/919876543210",
    );
  });

  it("adds subject and body when drafting an email handoff", () => {
    expect(
      buildHandoffUrl(ch("email", "p@x.com"), {
        subject: "Re: Roster & gates",
        body: "Line 1\nLine 2",
      }),
    ).toBe(
      "mailto:p@x.com?subject=Re%3A+Roster+%26+gates&body=Line+1%0ALine+2",
    );
  });

  it("returns null for telegram (auto-send only) and empty values", () => {
    expect(buildHandoffUrl(ch("telegram", "12345"))).toBeNull();
    expect(buildHandoffUrl(ch("email", "   "))).toBeNull();
  });
});

describe("openContactChannel", () => {
  it("opens a handoff URL and reports success", async () => {
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    vaultMocks.readRowMarkdownFrom.mockResolvedValue(null);
    const ok = await openContactChannel(ch("email", "p@x.com"));
    expect(ok).toBe(true);
    expect(shell.openExternal).toHaveBeenCalledWith("mailto:p@x.com");
  });

  it("does nothing for a channel with no OS handoff", async () => {
    vi.mocked(shell.openExternal).mockClear();
    const ok = await openContactChannel(ch("telegram", "12345"));
    expect(ok).toBe(false);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("logs outreach and schedules a contact follow-up task when context has a date", async () => {
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    vaultMocks.readRowMarkdownFrom.mockResolvedValue(
      [
        "---",
        'title: "Pat"',
        'schema: "person"',
        'fragments: [{"text":"Met at BlueBop"}]',
        "---",
        "",
        "Existing notes",
      ].join("\n"),
    );
    vaultMocks.exportRowMarkdownTo.mockResolvedValue(true);
    vaultMocks.setNagRecord.mockResolvedValue({
      rowId: "contact-follow-up-pat",
    });

    const ok = await openContactChannel(
      ch("email", "pat@example.com"),
      undefined,
      {
        personId: "pat",
        personName: "Pat",
        followUpAt: "2026-07-09",
        note: "Task: confirm Friday roster",
      },
      "default",
    );

    expect(ok).toBe(true);
    const peopleWrite = vaultMocks.exportRowMarkdownTo.mock.calls.find(
      (call) => call[1] === "people",
    );
    expect(peopleWrite?.[0]).toBe("/vault");
    expect(peopleWrite?.[2]).toBe("pat");
    expect(String(peopleWrite?.[3])).toContain(
      "Opened email handoff to Pat. Task: confirm Friday roster",
    );
    expect(String(peopleWrite?.[3])).toContain('followUpAt: "2026-07-09"');
    expect(String(peopleWrite?.[3])).toContain("Existing notes");

    const taskWrite = vaultMocks.exportRowMarkdownTo.mock.calls.find(
      (call) => call[1] === "tasks",
    );
    expect(taskWrite?.[2]).toBe("contact-follow-up-pat");
    expect(String(taskWrite?.[3])).toContain('title: "Follow up with Pat"');
    expect(String(taskWrite?.[3])).toContain('due: "2026-07-09"');
    expect(vaultMocks.setNagRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "contact-follow-up-pat",
        nagCount: 0,
        nextNagAt: new Date("2026-07-09T23:59:59").getTime(),
        cadence: "daily",
      }),
      "default",
    );
  });
});
