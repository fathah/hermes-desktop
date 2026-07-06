import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

vi.mock("lucide-react", () => ({
  ChevronDown: () => null,
}));

import { ModelPicker } from "./ModelPicker";
import type { ModelGroup } from "./types";

const groups: ModelGroup[] = [
  {
    provider: "openrouter",
    providerLabel: "providers.openrouter",
    models: [
      {
        provider: "openrouter",
        model: "owl-alpha",
        label: "OWL Alpha",
        baseUrl: "",
      },
      {
        provider: "openrouter",
        model: "owl-beta",
        label: "OWL Beta",
        baseUrl: "",
      },
    ],
  },
  {
    provider: "ollama",
    providerLabel: "providers.ollama",
    models: [
      {
        provider: "ollama",
        model: "llama3",
        label: "Llama 3",
        baseUrl: "http://localhost:11434",
      },
    ],
  },
];

/** Render helper that also returns the container for scoped DOM queries. */
function renderPicker(
  overrides: {
    active?: boolean;
    currentModel?: string;
    currentProvider?: string;
    currentBaseUrl?: string;
    modelGroups?: ModelGroup[];
    displayModel?: string;
    onOpen?: () => void;
    onSelectModel?: (provider: string, model: string, baseUrl: string) => void;
  } = {},
): { container: HTMLElement; onOpen: Mock; onSelectModel: Mock } {
  const onOpen = vi.fn();
  const onSelectModel = vi.fn();
  const utils = render(
    <ModelPicker
      active={overrides.active}
      currentModel={overrides.currentModel ?? "owl-alpha"}
      currentProvider={overrides.currentProvider ?? "openrouter"}
      currentBaseUrl={overrides.currentBaseUrl ?? ""}
      modelGroups={overrides.modelGroups ?? groups}
      displayModel={overrides.displayModel ?? "OWL Alpha"}
      onOpen={overrides.onOpen ?? onOpen}
      onSelectModel={overrides.onSelectModel ?? onSelectModel}
    />,
  );
  return { ...utils, onOpen, onSelectModel };
}

/** Click the trigger button (scoped to container to avoid ambiguity) and
 *  return the dropdown element for `within()` scoping. */
function openPicker(container: HTMLElement): HTMLElement {
  const trigger = container.querySelector(
    ".chat-model-trigger",
  ) as HTMLButtonElement;
  fireEvent.click(trigger);
  return container.querySelector(".chat-model-dropdown") as HTMLElement;
}

describe("ModelPicker", () => {
  // ── initial render ──────────────────────────────────────────────
  it("renders the display model name in the trigger button", () => {
    const { container } = renderPicker({ displayModel: "OWL Alpha" });
    const trigger = container.querySelector(".chat-model-trigger")!;
    expect(trigger.querySelector(".chat-model-name")?.textContent).toBe(
      "OWL Alpha",
    );
  });

  it("does not show the dropdown initially", () => {
    const { container } = renderPicker();
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  // ── open / close ────────────────────────────────────────────────
  it("opens the dropdown and calls onOpen when the trigger is clicked", () => {
    const { container, onOpen } = renderPicker();
    openPicker(container);
    expect(screen.getByPlaceholderText("chat.searchModels")).toBeTruthy();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("closes the dropdown when the trigger is clicked again", () => {
    const { container } = renderPicker();
    const trigger = container.querySelector(
      ".chat-model-trigger",
    ) as HTMLButtonElement;
    fireEvent.click(trigger); // open
    fireEvent.click(trigger); // close
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  it("closes the dropdown when clicking outside", () => {
    const { container } = renderPicker();
    openPicker(container);
    fireEvent.mouseDown(document.body);
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  it("closes the dropdown when pressing Escape", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    fireEvent.keyDown(dropdown, { key: "Escape" });
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  it("opens from a slash-command event only when the chat is active", () => {
    const active = renderPicker({ active: true });
    const inactive = renderPicker({ active: false });

    act(() => {
      window.dispatchEvent(new CustomEvent("model-picker:open"));
    });

    expect(
      active.container.querySelector(".chat-model-dropdown"),
    ).not.toBeNull();
    expect(inactive.container.querySelector(".chat-model-dropdown")).toBeNull();
    expect(active.onOpen).toHaveBeenCalledTimes(1);
    expect(inactive.onOpen).not.toHaveBeenCalled();
  });

  // ── model list rendering ────────────────────────────────────────
  it("renders all provider groups and their models", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    expect(within(dropdown).getByText("providers.openrouter")).toBeTruthy();
    expect(within(dropdown).getByText("providers.ollama")).toBeTruthy();
    expect(within(dropdown).getByText("OWL Alpha")).toBeTruthy();
    expect(within(dropdown).getByText("OWL Beta")).toBeTruthy();
    expect(within(dropdown).getByText("Llama 3")).toBeTruthy();
  });

  it("marks the active model with the 'active' class", () => {
    const { container } = renderPicker({
      currentModel: "owl-alpha",
      currentProvider: "openrouter",
    });
    const dropdown = openPicker(container);

    const option = within(dropdown).getByText("OWL Alpha").closest("button");
    expect(option?.className).toContain("active");
  });

  it("does not mark an inactive model as active", () => {
    const { container } = renderPicker({
      currentModel: "owl-alpha",
      currentProvider: "openrouter",
    });
    const dropdown = openPicker(container);

    const betaOption = within(dropdown).getByText("OWL Beta").closest("button");
    expect(betaOption?.className).not.toContain("active");
  });

  // ── model selection ─────────────────────────────────────────────
  it("calls onSelectModel with correct args when a model is clicked", () => {
    const { container, onSelectModel } = renderPicker();
    const dropdown = openPicker(container);

    fireEvent.click(within(dropdown).getByText("Llama 3"));

    expect(onSelectModel).toHaveBeenCalledWith(
      "ollama",
      "llama3",
      "http://localhost:11434",
    );
  });

  it("closes the dropdown after selecting a model", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    fireEvent.click(within(dropdown).getByText("OWL Beta"));
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  // ── search / filtering ──────────────────────────────────────────
  it("filters models by label (case-insensitive)", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const search = within(dropdown).getByPlaceholderText("chat.searchModels");

    fireEvent.change(search, { target: { value: "beta" } });

    expect(within(dropdown).queryByText("OWL Alpha")).toBeNull();
    expect(within(dropdown).getByText("OWL Beta")).toBeTruthy();
    expect(within(dropdown).queryByText("Llama 3")).toBeNull();
  });

  it("filters models by model id", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const search = within(dropdown).getByPlaceholderText("chat.searchModels");

    fireEvent.change(search, { target: { value: "llama3" } });

    expect(within(dropdown).queryByText("OWL Alpha")).toBeNull();
    expect(within(dropdown).getByText("Llama 3")).toBeTruthy();
  });

  it("shows all models when search is cleared", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const search = within(dropdown).getByPlaceholderText("chat.searchModels");

    fireEvent.change(search, { target: { value: "beta" } });
    fireEvent.change(search, { target: { value: "" } });

    expect(within(dropdown).getByText("OWL Alpha")).toBeTruthy();
    expect(within(dropdown).getByText("Llama 3")).toBeTruthy();
  });

  it("clears search when the dropdown is toggled closed", () => {
    const { container } = renderPicker();
    const trigger = container.querySelector(
      ".chat-model-trigger",
    ) as HTMLButtonElement;

    fireEvent.click(trigger); // open
    const search = container.querySelector(
      ".chat-model-search-input",
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "beta" } });
    expect(search.value).toBe("beta");

    fireEvent.click(trigger); // close
    fireEvent.click(trigger); // re-open

    const searchAfter = container.querySelector(
      ".chat-model-search-input",
    ) as HTMLInputElement;
    expect(searchAfter.value).toBe("");
  });

  // ── custom model input ──────────────────────────────────────────
  it("renders the custom model input section", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    expect(within(dropdown).getByText("chat.custom")).toBeTruthy();
    expect(
      within(dropdown).getByPlaceholderText("chat.typeModelName"),
    ).toBeTruthy();
  });

  it("submits a custom model on Enter and calls onSelectModel", () => {
    const { container, onSelectModel } = renderPicker();
    const dropdown = openPicker(container);

    const customInput = within(dropdown).getByPlaceholderText(
      "chat.typeModelName",
    ) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: "my-custom-model" } });
    fireEvent.keyDown(customInput, { key: "Enter" });

    expect(onSelectModel).toHaveBeenCalledWith(
      "openrouter",
      "my-custom-model",
      "",
    );
  });

  it("uses 'auto' provider when currentProvider is 'auto'", () => {
    const { container, onSelectModel } = renderPicker({
      currentProvider: "auto",
    });
    const dropdown = openPicker(container);

    const customInput = within(dropdown).getByPlaceholderText(
      "chat.typeModelName",
    ) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: "gpt-4o" } });
    fireEvent.keyDown(customInput, { key: "Enter" });

    expect(onSelectModel).toHaveBeenCalledWith("auto", "gpt-4o", "");
  });

  it("does not submit an empty custom model", () => {
    const { container, onSelectModel } = renderPicker();
    const dropdown = openPicker(container);

    const customInput =
      within(dropdown).getByPlaceholderText("chat.typeModelName");
    fireEvent.keyDown(customInput, { key: "Enter" });

    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it("does not submit whitespace-only custom model", () => {
    const { container, onSelectModel } = renderPicker();
    const dropdown = openPicker(container);

    const customInput = within(dropdown).getByPlaceholderText(
      "chat.typeModelName",
    ) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: "   " } });
    fireEvent.keyDown(customInput, { key: "Enter" });

    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it("closes the dropdown after submitting a custom model", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    const customInput = within(dropdown).getByPlaceholderText(
      "chat.typeModelName",
    ) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: "custom" } });
    fireEvent.keyDown(customInput, { key: "Enter" });

    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  // ── edge cases ──────────────────────────────────────────────────
  it("renders nothing in the dropdown when modelGroups is empty", () => {
    const { container } = renderPicker({ modelGroups: [] });
    const dropdown = openPicker(container);
    expect(within(dropdown).getByText("chat.custom")).toBeTruthy();
    expect(within(dropdown).queryByText("providers.openrouter")).toBeNull();
  });

  it("renders nothing when search matches no models", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const search = within(dropdown).getByPlaceholderText("chat.searchModels");

    fireEvent.change(search, { target: { value: "zzzznonexistent" } });

    expect(within(dropdown).queryByText("OWL Alpha")).toBeNull();
    expect(within(dropdown).queryByText("Llama 3")).toBeNull();
  });
});
