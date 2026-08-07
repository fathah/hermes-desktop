import { act, renderHook, waitFor } from "@testing-library/react";
import {
  SoftBackgroundProvider,
  useSoftBackground,
} from "./SoftBackgroundProvider";

describe("SoftBackgroundProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-soft-background");
    document.documentElement.style.removeProperty("--soft-background-image");
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listSoftBackgrounds: vi.fn().mockResolvedValue([]),
        addSoftBackgrounds: vi.fn().mockResolvedValue([]),
        removeSoftBackground: vi.fn().mockResolvedValue(true),
      } as unknown as Window["hermesAPI"],
    });
  });

  it("persists and applies a selected background", () => {
    const wrapper = ({
      children,
    }: {
      children: React.ReactNode;
    }): React.JSX.Element => (
      <SoftBackgroundProvider>{children}</SoftBackgroundProvider>
    );
    const { result } = renderHook(() => useSoftBackground(), { wrapper });

    act(() =>
      result.current.setBackgroundForProfile("default", "artoria-avalon"),
    );

    expect(
      JSON.parse(
        localStorage.getItem("hermes-soft-backgrounds-by-profile") || "{}",
      ),
    ).toEqual({ default: "artoria-avalon" });
    expect(document.documentElement.dataset.softBackground).toBe(
      "artoria-avalon",
    );
    expect(
      document.documentElement.style.getPropertyValue(
        "--soft-background-image",
      ),
    ).toContain("artoria-avalon.png");
  });

  it("falls back to none for an unknown saved value", () => {
    localStorage.setItem("hermes-soft-background", "missing");
    const wrapper = ({
      children,
    }: {
      children: React.ReactNode;
    }): React.JSX.Element => (
      <SoftBackgroundProvider>{children}</SoftBackgroundProvider>
    );
    const { result } = renderHook(() => useSoftBackground(), { wrapper });

    expect(result.current.backgroundForProfile("default")).toBe("none");
    expect(document.documentElement.dataset.softBackground).toBe("none");
  });

  it("adds and selects a user image", async () => {
    const custom = {
      id: "custom:00000000-0000-4000-8000-000000000000--my-image.png" as const,
      image:
        "hermes-background://image/00000000-0000-4000-8000-000000000000--my-image.png",
      name: "my image",
    };
    vi.mocked(window.hermesAPI.addSoftBackgrounds).mockResolvedValue([custom]);
    const wrapper = ({
      children,
    }: {
      children: React.ReactNode;
    }): React.JSX.Element => (
      <SoftBackgroundProvider>{children}</SoftBackgroundProvider>
    );
    const { result } = renderHook(() => useSoftBackground(), { wrapper });

    await act(async () => {
      const added = await result.current.addCustomBackgrounds();
      result.current.setBackgroundForProfile("writer", added[0].id);
      result.current.setActiveProfile("writer");
    });

    await waitFor(() =>
      expect(result.current.backgroundForProfile("writer")).toBe(custom.id),
    );
    expect(result.current.customBackgrounds).toEqual([custom]);
    expect(document.documentElement.dataset.softBackground).toBe(custom.id);
  });

  it("keeps a different selection for each agent", () => {
    const wrapper = ({
      children,
    }: {
      children: React.ReactNode;
    }): React.JSX.Element => (
      <SoftBackgroundProvider>{children}</SoftBackgroundProvider>
    );
    const { result } = renderHook(() => useSoftBackground(), { wrapper });

    act(() => {
      result.current.setBackgroundForProfile("writer", "artoria-avalon");
      result.current.setBackgroundForProfile("coder", "cyberpunk-moon");
      result.current.setActiveProfile("coder");
    });

    expect(result.current.backgroundForProfile("writer")).toBe(
      "artoria-avalon",
    );
    expect(result.current.backgroundForProfile("coder")).toBe("cyberpunk-moon");
    expect(document.documentElement.dataset.softBackground).toBe(
      "cyberpunk-moon",
    );
  });
});
