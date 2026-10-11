// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import PetSettings from "./PetSettings";

const { request, close, openGateway } = vi.hoisted(() => ({
  request: vi.fn(),
  close: vi.fn(),
  openGateway: vi.fn(),
}));
vi.mock("./petGateway", () => ({
  openPetGateway: openGateway,
  petRequest: (
    _client: unknown,
    profile: string,
    method: string,
    params = {},
  ) => request(method, { profile, ...params }),
}));
vi.mock("../useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

let notifyConnectionChange = (): void => {};
beforeEach(() => {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      onConnectionConfigChanged: vi.fn((handler) => {
        notifyConnectionChange = () => handler({});
        return vi.fn();
      }),
    },
  });
  openGateway.mockResolvedValue({ request, close, connected: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("PetSettings", () => {
  // @lat: [[shared-pets#Recovery regressions#Slow online gallery]]
  it("keeps a slow online gallery request authoritative across ordinary polls", async () => {
    let resolveOnline!: (value: unknown) => void;
    let galleryCalls = 0;
    request.mockImplementation(
      (method: string, params: { localOnly?: boolean }) => {
        if (method === "pet.gallery") {
          galleryCalls++;
          if (!params.localOnly)
            return new Promise((resolve) => {
              resolveOnline = resolve;
            });
          return Promise.resolve({ active: "", enabled: false, pets: [] });
        }
        return Promise.resolve({ enabled: false });
      },
    );
    render(<PetSettings profile="work" connectionId="machine-a" />);
    await waitFor(() => expect(galleryCalls).toBe(2));
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(24000);
    });
    expect(galleryCalls).toBe(2);
    await act(async () =>
      resolveOnline({
        active: "",
        enabled: false,
        pets: [{ slug: "online", displayName: "Online pet", installed: false }],
      }),
    );
    expect(screen.getByText("Online pet")).toBeInTheDocument();
  });

  // @lat: [[shared-pets#Recovery regressions#Generated pet rename]]
  it("renames with an in-app form and preserves the entered name after an RPC failure", async () => {
    let name = "My cat";
    let fail = true;
    request.mockImplementation((method: string, params: { name?: string }) => {
      if (method === "pet.gallery")
        return Promise.resolve({
          active: "",
          enabled: false,
          pets: [
            {
              slug: "cat",
              displayName: name,
              installed: true,
              generated: true,
            },
          ],
        });
      if (method === "pet.rename") {
        if (fail) return Promise.reject(new Error("Rename failed"));
        name = params.name!;
      }
      return Promise.resolve({ enabled: false });
    });
    const prompt = vi.spyOn(window, "prompt").mockImplementation(() => {
      throw new Error("Electron does not support prompt");
    });
    render(<PetSettings profile="work" connectionId="machine-a" />);
    await screen.findByText("My cat");
    fireEvent.click(
      screen.getByRole("button", { name: "settings.pet.rename" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "settings.pet.rename" }),
      {
        target: { value: "  New cat  " },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    expect(await screen.findByText("Rename failed")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "settings.pet.rename" }),
    ).toHaveValue("  New cat  ");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await screen.findByText("New cat");
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "settings.pet.rename" }),
      ).not.toBeInTheDocument(),
    );
    expect(request).toHaveBeenCalledWith("pet.rename", {
      profile: "work",
      slug: "cat",
      name: "New cat",
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  // @lat: [[shared-pets#Connection edit regressions#Settings refresh]]
  it("clears old gallery data and reconnects when the endpoint changes under the same connection ID", async () => {
    let resolveOld!: (value: unknown) => void;
    let calls = 0;
    request.mockImplementation((method: string) => {
      if (method === "pet.gallery") {
        if (++calls === 1)
          return new Promise((resolve) => {
            resolveOld = resolve;
          });
        return Promise.resolve({
          enabled: false,
          active: "",
          pets: [{ slug: "new", displayName: "New endpoint", installed: true }],
        });
      }
      return Promise.resolve({ enabled: false });
    });
    render(<PetSettings profile="work" connectionId="machine-a" />);
    await waitFor(() => expect(calls).toBe(1));
    act(() => notifyConnectionChange());
    expect(await screen.findByText("New endpoint")).toBeInTheDocument();
    await act(async () =>
      resolveOld({
        enabled: false,
        active: "",
        pets: [{ slug: "old", displayName: "Old endpoint", installed: true }],
      }),
    );
    expect(screen.queryByText("Old endpoint")).not.toBeInTheDocument();
    expect(close).toHaveBeenCalled();
    expect(openGateway).toHaveBeenCalledTimes(2);
  });

  it("loads the selected profile's gallery and adopts a pet through the backend", async () => {
    request.mockImplementation((method: string) => {
      if (method === "pet.gallery")
        return Promise.resolve({
          active: "",
          enabled: false,
          pets: [
            { slug: "pixel-cat", displayName: "Pixel Cat", installed: true },
          ],
        });
      if (method === "pet.info.meta")
        return Promise.resolve({ enabled: false });
      if (method === "pet.thumb")
        return Promise.resolve({ dataUri: "data:image/png;base64,test" });
      return Promise.resolve({ ok: true });
    });
    render(<PetSettings profile="phoenix" connectionId="machine-b" />);
    expect(await screen.findByText("Pixel Cat")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("pet.gallery", {
      profile: "phoenix",
      localOnly: true,
    });
    fireEvent.click(screen.getByRole("button", { name: /Pixel Cat/i }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("pet.select", {
        profile: "phoenix",
        slug: "pixel-cat",
      }),
    );
  });

  it("does not replace an adopted pet with a late initial manifest response", async () => {
    let resolveInitial: (value: unknown) => void = () => undefined;
    let galleryCalls = 0;
    const entry = {
      slug: "pixel-cat",
      displayName: "Pixel Cat",
      installed: true,
    };
    request.mockImplementation((method: string) => {
      if (method === "pet.gallery") {
        galleryCalls++;
        if (galleryCalls === 2)
          return new Promise((resolve) => {
            resolveInitial = resolve;
          });
        return Promise.resolve({
          active: galleryCalls > 2 ? "pixel-cat" : "",
          enabled: galleryCalls > 2,
          pets: [entry],
        });
      }
      if (method === "pet.info.meta")
        return Promise.resolve({
          enabled: galleryCalls > 2,
          slug: galleryCalls > 2 ? "pixel-cat" : "",
        });
      if (method === "pet.thumb")
        return Promise.resolve({ dataUri: "data:image/png;base64,test" });
      return Promise.resolve({ ok: true });
    });
    render(<PetSettings profile="phoenix" connectionId="machine-b" />);
    expect(await screen.findByText("Pixel Cat")).toBeInTheDocument();
    await waitFor(() => expect(galleryCalls).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: /Pixel Cat/i }));
    await waitFor(() => expect(galleryCalls).toBe(4));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Pixel Cat/i }),
      ).toHaveTextContent("settings.pet.active"),
    );
    await act(async () =>
      resolveInitial({
        active: "",
        enabled: false,
        pets: [{ ...entry, installed: false }],
      }),
    );
    expect(
      screen.getByRole("button", { name: "settings.pet.remove" }),
    ).toBeInTheDocument();
  });

  it("updates its active selection when another Hermes surface changes the pet", async () => {
    let onEvent: (event: { type: string }) => void = () => undefined;
    let selected = false;
    openGateway.mockImplementation(async (_profile, _connection, handler) => {
      onEvent = handler;
      return { request, close, connected: true };
    });
    request.mockImplementation((method: string) => {
      if (method === "pet.gallery")
        return Promise.resolve({
          active: selected ? "pixel-cat" : "",
          enabled: selected,
          pets: [
            { slug: "pixel-cat", displayName: "Pixel Cat", installed: true },
          ],
        });
      if (method === "pet.info.meta")
        return Promise.resolve({
          enabled: selected,
          slug: selected ? "pixel-cat" : "",
        });
      return Promise.resolve({ dataUri: "data:image/png;base64,test" });
    });
    render(<PetSettings profile="phoenix" connectionId="machine-b" />);
    expect(await screen.findByText("Pixel Cat")).toBeInTheDocument();
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("pet.gallery", {
        profile: "phoenix",
      }),
    );
    selected = true;
    act(() => onEvent({ type: "pet.changed" }));
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "settings.pet.enabled" }),
      ).toBeChecked(),
    );
    expect(
      screen.getByRole("button", { name: /Pixel Cat/i }),
    ).toHaveTextContent("settings.pet.active");
  });

  it("ignores an old initial local gallery after a newer pet.changed refresh", async () => {
    let onEvent: (event: { type: string }) => void = () => undefined;
    let resolveOld: (value: unknown) => void = () => undefined;
    let localCalls = 0;
    openGateway.mockImplementation(async (_profile, _connection, handler) => {
      onEvent = handler;
      return { request, close, connected: true };
    });
    request.mockImplementation(
      (method: string, params: { localOnly?: boolean }) => {
        if (method === "pet.gallery") {
          if (params.localOnly && ++localCalls === 1)
            return new Promise((resolve) => {
              resolveOld = resolve;
            });
          return Promise.resolve({
            active: "pixel-cat",
            enabled: true,
            pets: [
              { slug: "pixel-cat", displayName: "Pixel Cat", installed: true },
            ],
          });
        }
        if (method === "pet.info.meta")
          return Promise.resolve({ enabled: true, slug: "pixel-cat" });
        return Promise.resolve({ dataUri: "data:image/png;base64,test" });
      },
    );
    render(<PetSettings profile="phoenix" connectionId="machine-b" />);
    await waitFor(() => expect(localCalls).toBe(1));
    act(() => onEvent({ type: "pet.changed" }));
    expect(await screen.findByText("Pixel Cat")).toBeInTheDocument();
    await act(async () => resolveOld({ active: "", enabled: false, pets: [] }));
    expect(
      screen.getByRole("checkbox", { name: "settings.pet.enabled" }),
    ).toBeChecked();
    expect(screen.getByText("Pixel Cat")).toBeInTheDocument();
  });

  it("recovers Pets settings on focus after the first gateway connection fails", async () => {
    openGateway
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ request, close, connected: true });
    request.mockImplementation((method: string) => {
      if (method === "pet.gallery")
        return Promise.resolve({
          active: "pixel-cat",
          enabled: true,
          pets: [
            { slug: "pixel-cat", displayName: "Pixel Cat", installed: true },
          ],
        });
      if (method === "pet.info.meta")
        return Promise.resolve({ enabled: true, slug: "pixel-cat" });
      return Promise.resolve({ dataUri: "data:image/png;base64,test" });
    });
    render(<PetSettings profile="phoenix" connectionId="machine-b" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("Pixel Cat")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(openGateway.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(openGateway).toHaveBeenLastCalledWith(
      "phoenix",
      "machine-b",
      expect.any(Function),
    );
  });

  it("reports a failed metadata read even when the gateway socket stays connected", async () => {
    request.mockImplementation((method: string) => {
      if (method === "pet.info.meta")
        return Promise.reject(new Error("metadata unavailable"));
      if (method === "pet.gallery")
        return Promise.resolve({ active: "", enabled: false, pets: [] });
      return Promise.resolve({});
    });
    render(<PetSettings profile="phoenix" connectionId="machine-b" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "metadata unavailable",
    );
    expect(screen.queryByText("settings.pet.loading")).not.toBeInTheDocument();
  });

  it("ignores an old pet selection completion after settings changes profile", async () => {
    let resolveSelect: (value: unknown) => void = () => undefined;
    request.mockImplementation(
      (method: string, params: { profile: string }) => {
        if (method === "pet.select")
          return new Promise((resolve) => {
            resolveSelect = resolve;
          });
        const name = params.profile === "phoenix" ? "Pixel Cat" : "Pixel Dog";
        const slug = params.profile === "phoenix" ? "cat" : "dog";
        if (method === "pet.gallery")
          return Promise.resolve({
            enabled: false,
            active: "",
            pets: [{ slug, displayName: name, installed: true }],
          });
        if (method === "pet.info.meta")
          return Promise.resolve({ enabled: false });
        return Promise.resolve({ dataUri: "data:image/png;base64,test" });
      },
    );
    const { rerender } = render(
      <PetSettings profile="phoenix" connectionId="machine-b" />,
    );
    expect(await screen.findByText("Pixel Cat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pixel Cat/i }));
    rerender(<PetSettings profile="other" connectionId="machine-b" />);
    expect(await screen.findByText("Pixel Dog")).toBeInTheDocument();
    await act(async () => resolveSelect({ ok: true }));
    expect(screen.getByText("Pixel Dog")).toBeInTheDocument();
    expect(screen.queryByText("Pixel Cat")).not.toBeInTheDocument();
  });

  it("does not let polling supersede an in-flight metadata request before its timeout", async () => {
    let rejectMetadata: (error: Error) => void = () => undefined;
    request.mockImplementation((method: string) => {
      if (method === "pet.info.meta")
        return new Promise((_, reject) => {
          rejectMetadata = reject;
        });
      if (method === "pet.gallery")
        return Promise.resolve({ enabled: false, active: "", pets: [] });
      return Promise.resolve({});
    });
    vi.useFakeTimers();
    render(<PetSettings profile="phoenix" connectionId="machine-b" />);
    await act(async () => undefined);
    const metaCalls = (): number =>
      request.mock.calls.filter(([method]) => method === "pet.info.meta")
        .length;
    expect(metaCalls()).toBe(1);
    await act(async () => vi.advanceTimersByTime(24000));
    expect(metaCalls()).toBe(1);
    await act(async () => rejectMetadata(new Error("metadata timed out")));
    expect(screen.getByRole("alert")).toHaveTextContent("metadata timed out");
  });

  it("keeps concurrent thumbnail results when another thumbnail completes first", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    request.mockImplementation((method: string, params: { slug?: string }) => {
      if (method === "pet.gallery")
        return Promise.resolve({
          enabled: false,
          active: "",
          pets: [
            { slug: "cat", displayName: "Cat", installed: true },
            { slug: "dog", displayName: "Dog", installed: true },
          ],
        });
      if (method === "pet.info.meta")
        return Promise.resolve({ enabled: false });
      if (method === "pet.thumb")
        return new Promise((resolve) => {
          pending.set(params.slug!, resolve);
        });
      return Promise.resolve({});
    });
    render(<PetSettings profile="phoenix" connectionId="machine-b" />);
    await waitFor(() => expect(pending.size).toBe(2));
    await act(async () =>
      pending.get("cat")?.({ dataUri: "data:image/png;base64,cat" }),
    );
    await act(async () =>
      pending.get("dog")?.({ dataUri: "data:image/png;base64,dog" }),
    );
    expect(document.querySelectorAll(".pet-settings-card img")).toHaveLength(2);
    expect(
      request.mock.calls.filter(([method]) => method === "pet.thumb"),
    ).toHaveLength(2);
  });
  it("retries a failed thumbnail on a later gallery refresh, not immediately", async () => {
    let onEvent: (event: { type: string }) => void = () => undefined;
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    openGateway.mockImplementation(async (_profile, _connection, handler) => {
      onEvent = handler;
      return { request, close, connected: true };
    });
    let thumbCalls = 0;
    request.mockImplementation((method: string) => {
      if (method === "pet.gallery")
        return Promise.resolve({
          enabled: false,
          active: "",
          pets: [{ slug: "cat", displayName: "Cat", installed: true }],
        });
      if (method === "pet.info.meta")
        return Promise.resolve({ enabled: false });
      if (method === "pet.thumb") {
        thumbCalls++;
        return thumbCalls === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ dataUri: "data:image/png;base64,cat" });
      }
      return Promise.resolve({});
    });
    render(<PetSettings profile="phoenix" connectionId="machine-b" />);
    await waitFor(() => expect(thumbCalls).toBe(1));
    await act(async () => undefined);
    now = 13000;
    act(() => onEvent({ type: "pet.changed" }));
    await waitFor(() => expect(thumbCalls).toBe(2));
    expect(document.querySelectorAll(".pet-settings-card img")).toHaveLength(1);
  });
});
