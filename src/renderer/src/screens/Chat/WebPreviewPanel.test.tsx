import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

vi.mock("lucide-react", () => ({
  X: () => null,
  ArrowLeft: () => null,
  ArrowRight: () => null,
  RotateCw: () => null,
  ExternalLink: () => null,
  Globe: () => null,
  MousePointerClick: () => null,
  MessageCircle: () => null,
  ArrowUp: () => null,
}));

import { WebPreviewPanel } from "./WebPreviewPanel";

interface InspectionResult {
  selector: string;
  rect: { left: number; top: number; width: number; height: number };
}

function deferredInspection(): {
  promise: Promise<InspectionResult | null>;
  resolve: (value: InspectionResult | null) => void;
} {
  let resolve!: (value: InspectionResult | null) => void;
  const promise = new Promise<InspectionResult | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function installInspectorBridge(
  inspectWebPreview: ReturnType<typeof vi.fn>,
  cancelWebPreviewInspection: ReturnType<typeof vi.fn>,
): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      inspectWebPreview,
      cancelWebPreviewInspection,
    } as unknown as typeof window.hermesAPI,
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "hermesAPI");
  vi.restoreAllMocks();
});

describe("WebPreviewPanel annotation lifecycle", () => {
  it("keeps annotation available after SPA navigation and submits selector plus comment", async () => {
    const inspection = deferredInspection();
    const inspectWebPreview = vi.fn(() => inspection.promise);
    const cancelWebPreviewInspection = vi.fn().mockResolvedValue(undefined);
    installInspectorBridge(inspectWebPreview, cancelWebPreviewInspection);
    const onInspectElement = vi.fn();
    const {
      container,
      getByPlaceholderText,
      getByTitle,
      queryByPlaceholderText,
    } = render(
      <WebPreviewPanel
        initialUrl="http://localhost:3000/"
        onClose={vi.fn()}
        onInspectElement={onInspectElement}
      />,
    );
    const webview = container.querySelector("webview") as HTMLElement & {
      canGoBack: () => boolean;
      canGoForward: () => boolean;
      getWebContentsId: () => number;
    };
    webview.canGoBack = () => false;
    webview.canGoForward = () => false;
    webview.getWebContentsId = () => 42;

    act(() => webview.dispatchEvent(new Event("dom-ready")));

    const navigation = new Event("did-navigate-in-page") as Event & {
      url: string;
    };
    navigation.url = "http://localhost:3000/#hydrated";
    act(() => webview.dispatchEvent(navigation));

    fireEvent.click(getByTitle("Annotate page"));
    await waitFor(() => {
      expect(inspectWebPreview).toHaveBeenCalledWith(42);
    });

    await act(async () => {
      inspection.resolve({
        selector: "#hero-heading",
        rect: { left: 20, top: 30, width: 300, height: 80 },
      });
      await inspection.promise;
    });

    const commentInput = await waitFor(() => {
      const input = getByPlaceholderText("Add a comment…");
      expect(input).toBe(document.activeElement);
      return input;
    });
    const outline = container.querySelector(".web-preview-annotation-outline");
    expect(outline).toHaveStyle({
      left: "20px",
      top: "30px",
      width: "300px",
      height: "80px",
    });

    const submitButton = getByTitle("Add annotation to chat");
    expect(submitButton).toBeDisabled();
    fireEvent.change(commentInput, {
      target: { value: "  Make this heading smaller  " },
    });
    expect(submitButton).not.toBeDisabled();
    fireEvent.submit(commentInput.closest("form") as HTMLFormElement);

    expect(onInspectElement).toHaveBeenCalledWith({
      selector: "#hero-heading",
      comment: "Make this heading smaller",
    });
    await waitFor(() => {
      expect(queryByPlaceholderText("Add a comment…")).toBeNull();
      expect(cancelWebPreviewInspection).toHaveBeenCalledWith(42);
    });
  });

  it("ignores stale results and cancels the active isolated inspection", async () => {
    const firstInspection = deferredInspection();
    const secondInspection = deferredInspection();
    const inspectWebPreview = vi
      .fn()
      .mockReturnValueOnce(firstInspection.promise)
      .mockReturnValueOnce(secondInspection.promise);
    const cancelWebPreviewInspection = vi.fn().mockResolvedValue(undefined);
    installInspectorBridge(inspectWebPreview, cancelWebPreviewInspection);
    const { container, getByPlaceholderText, getByTitle } = render(
      <WebPreviewPanel
        initialUrl="https://example.com/"
        onClose={vi.fn()}
        onInspectElement={vi.fn()}
      />,
    );
    const webview = container.querySelector("webview") as HTMLElement & {
      canGoBack: () => boolean;
      canGoForward: () => boolean;
      getWebContentsId: () => number;
    };
    webview.canGoBack = () => false;
    webview.canGoForward = () => false;
    webview.getWebContentsId = () => 77;

    act(() => webview.dispatchEvent(new Event("dom-ready")));
    fireEvent.click(getByTitle("Annotate page"));
    await waitFor(() => expect(inspectWebPreview).toHaveBeenCalledTimes(1));

    fireEvent.click(getByTitle("Stop annotating"));
    await waitFor(() => {
      expect(cancelWebPreviewInspection).toHaveBeenCalledWith(77);
    });
    fireEvent.click(getByTitle("Annotate page"));
    await waitFor(() => expect(inspectWebPreview).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstInspection.resolve({
        selector: "#stale",
        rect: { left: 0, top: 0, width: 10, height: 10 },
      });
      await firstInspection.promise;
    });
    expect(
      container.querySelector(".web-preview-annotation-outline"),
    ).toBeNull();

    await act(async () => {
      secondInspection.resolve({
        selector: "#fresh",
        rect: { left: 10, top: 10, width: 20, height: 20 },
      });
      await secondInspection.promise;
    });
    const input = await waitFor(() => getByPlaceholderText("Add a comment…"));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(getByTitle("Annotate page")).toBeInTheDocument();
      expect(cancelWebPreviewInspection).toHaveBeenCalledTimes(2);
    });
  });
});
