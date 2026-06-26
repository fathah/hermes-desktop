import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));

import { buildHandoffUrl, openContactChannel } from "./contact-messaging";
import { shell } from "electron";
import type { ContactChannel } from "../shared/contacts";

const ch = (kind: ContactChannel["kind"], value: string): ContactChannel => ({
  kind,
  value,
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

  it("returns null for telegram (auto-send only) and empty values", () => {
    expect(buildHandoffUrl(ch("telegram", "12345"))).toBeNull();
    expect(buildHandoffUrl(ch("email", "   "))).toBeNull();
  });
});

describe("openContactChannel", () => {
  it("opens a handoff URL and reports success", async () => {
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
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
});
