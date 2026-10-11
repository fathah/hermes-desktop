// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsModalProvider } from "./SettingsModalProvider";
import { useSettingsModal } from "./SettingsModalContext";

const { request, open, close } = vi.hoisted(() => ({
  request: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("./useSettingsData", () => ({
  useSettingsData: () => ({
    connectionId: "global-machine",
    hermesVersion: null,
  }),
}));
vi.mock("../pet/petGateway", () => ({
  openPetGateway: open,
  petRequest: (
    _client: unknown,
    profile: string,
    method: string,
    params = {},
  ) => request(method, { ...params, profile }),
}));
function Entry({
  machine,
  profile,
}: {
  machine: string;
  profile: string;
}): React.JSX.Element {
  const { openSettings } = useSettingsModal();
  return (
    <button
      onClick={() => openSettings("pets", { connectionId: machine, profile })}
    >
      Open conversation pets
    </button>
  );
}
beforeEach(() => {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      onConnectionConfigChanged: vi.fn().mockReturnValue(vi.fn()),
    },
  });
  open.mockResolvedValue({ request, close, connected: true });
  request.mockImplementation((method: string) =>
    Promise.resolve(
      method === "pet.gallery"
        ? {
            enabled: false,
            active: "",
            pets: [
              {
                slug: "cat",
                displayName: "Cat",
                installed: true,
                generated: true,
              },
            ],
          }
        : { enabled: false },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// @lat: [[shared-pets#Settings navigation]]
it("routes a real settings dialog from the conversation and keeps mutations on its machine/profile", async () => {
  const view = render(
    <SettingsModalProvider>
      <Entry machine="conversation-machine" profile="work" />
    </SettingsModalProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Open conversation pets" }),
  );
  await screen.findByRole("button", { name: /Cat/ });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Cat/ })).toBeVisible(),
  );
  expect(open).toHaveBeenCalledWith(
    "work",
    "conversation-machine",
    expect.any(Function),
  );
  fireEvent.click(screen.getByRole("button", { name: /Cat/ }));
  await act(async () => {});
  expect(request).toHaveBeenCalledWith("pet.select", {
    slug: "cat",
    profile: "work",
  });
  fireEvent.click(screen.getByRole("button", { name: "settings.pet.rename" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "settings.pet.rename" }),
    {
      target: { value: "Conversation cat" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("pet.rename", {
      slug: "cat",
      name: "Conversation cat",
      profile: "work",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "settings.pet.rename" }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  view.rerender(
    <SettingsModalProvider>
      <Entry machine="other-machine" profile="default" />
    </SettingsModalProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Open conversation pets" }),
  );
  await screen.findByRole("button", { name: /Cat/ });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Cat/ })).toBeVisible(),
  );
  expect(close).toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith(
    "default",
    "other-machine",
    expect.any(Function),
  );
  fireEvent.click(screen.getByRole("button", { name: /Cat/ }));
  await act(async () => {});
  expect(request).toHaveBeenLastCalledWith("pet.gallery", {
    profile: "default",
  });
  expect(request).toHaveBeenCalledWith("pet.select", {
    slug: "cat",
    profile: "default",
  });
  expect(open.mock.calls.some((call) => call[1] === "global-machine")).toBe(
    false,
  );
});
