// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsModalProvider } from "./SettingsModalProvider";
import { useSettingsModal } from "./SettingsModalContext";

vi.mock("./SettingsModal", () => ({
  default: ({
    connectionId,
    profile,
  }: {
    connectionId?: string;
    profile?: string;
  }) => (
    <div data-testid="modal-route">
      {connectionId}:{profile}
    </div>
  ),
}));

function OpenPetSettings(): React.JSX.Element {
  const { openSettings } = useSettingsModal();
  return (
    <button
      onClick={() =>
        openSettings("pets", { connectionId: "machine-a", profile: "phoenix" })
      }
    >
      Open pets
    </button>
  );
}

afterEach(cleanup);

it("preserves the conversation machine when opening its profile's pet settings", () => {
  render(
    <SettingsModalProvider>
      <OpenPetSettings />
    </SettingsModalProvider>,
  );
  act(() => screen.getByRole("button", { name: "Open pets" }).click());
  expect(screen.getByTestId("modal-route")).toHaveTextContent(
    "machine-a:phoenix",
  );
});
