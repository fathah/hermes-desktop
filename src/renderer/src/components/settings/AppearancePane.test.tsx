import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Node built-ins are available to Vitest, but intentionally
// excluded from the renderer application's type environment.
import { readFileSync } from "node:fs";
// @ts-expect-error See the Vitest-only Node import above.
import { join } from "node:path";
import AppearancePane from "./AppearancePane";

declare const __dirname: string;

const mainCss = readFileSync(join(__dirname, "../../assets/main.css"), "utf8");

function cssBlock(selector: string, source = mainCss): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const selectorMatch = new RegExp(`${escapedSelector}\\s*\\{`).exec(source);
  if (!selectorMatch) {
    throw new Error(`Missing CSS block: ${selector}`);
  }

  const blockStart = source.indexOf("{", selectorMatch.index);
  let depth = 0;
  for (let i = blockStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(blockStart + 1, i);
  }

  throw new Error(`Unclosed CSS block: ${selector}`);
}

function expectDeclaration(block: string, declaration: string): void {
  expect(block.replace(/\s+/g, " ")).toContain(declaration);
}

const theme = vi.hoisted(() => ({
  theme: "light",
  setTheme: vi.fn(),
  rounded: true,
  setRounded: vi.fn(),
}));

const font = vi.hoisted(() => ({
  font: "manrope",
  setFont: vi.fn(),
}));

const translations = vi.hoisted(() => new Map<string, string>());

vi.mock("../ThemeProvider", () => ({ useTheme: () => theme }));
vi.mock("../FontProvider", () => ({ useFont: () => font }));
vi.mock("../useI18n", () => ({
  useI18n: () => ({ t: (key: string) => translations.get(key) ?? key }),
}));

function installGpuStatus(): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getGpuStatus: vi.fn().mockResolvedValue({
        disabled: false,
        reason: null,
        flagWrittenAt: null,
        canReenable: false,
        preference: "auto",
        bootPreference: "auto",
      }),
      setGpuPreference: vi.fn().mockResolvedValue(true),
      relaunchApp: vi.fn().mockResolvedValue(undefined),
    },
  });
}

describe("AppearancePane translated preference layout contract", () => {
  beforeEach(() => {
    translations.clear();
    installGpuStatus();
    document.documentElement.dir = "ltr";
  });

  it("keeps long translations in the shared responsive grid contract", async () => {
    // @lat: [[sidebar-navigation#Settings modal#Long translated preference layout]]
    translations.set(
      "settings.roundedCorners.hint",
      "Turn this off to use precisely squared-off corners everywhere in the application",
    );
    translations.set(
      "settings.hardwareAcceleration.on",
      "Keep acceleration enabled whenever possible",
    );

    const { container } = render(<AppearancePane />);

    await waitFor(() => {
      expect(container.querySelectorAll(".settings-row")).toHaveLength(3);
    });

    for (const row of container.querySelectorAll(".settings-row")) {
      expect(row.children).toHaveLength(2);
      expect(row.children[0]).toHaveClass("settings-row-text");
      expect(row.children[1]).toHaveClass("settings-row-control");
    }

    expectDeclaration(cssBlock(".settings-group"), "display: grid;");
    expectDeclaration(
      cssBlock(".settings-group"),
      "grid-template-columns: minmax(0, 1fr) fit-content(52%);",
    );
    expectDeclaration(cssBlock(".settings-row"), "display: grid;");
    expectDeclaration(
      cssBlock(".settings-row"),
      "grid-template-columns: subgrid;",
    );
    expectDeclaration(cssBlock(".settings-row"), "grid-column: 1 / -1;");
    expectDeclaration(cssBlock(".settings-row-text"), "min-width: 0;");
    expectDeclaration(cssBlock(".settings-row-control"), "min-width: 0;");
    expectDeclaration(cssBlock(".settings-seg"), "max-width: 100%;");
    expectDeclaration(cssBlock(".settings-seg"), "flex-wrap: wrap;");
    expectDeclaration(
      cssBlock(".settings-seg-btn"),
      "overflow-wrap: anywhere;",
    );
  });

  it("preserves the logical-direction CSS contract for RTL and narrow containers", async () => {
    // @lat: [[sidebar-navigation#Settings modal#RTL and narrow preference layout]]
    document.documentElement.dir = "rtl";
    translations.set("settings.roundedCorners.label", "زوايا مدورة");
    translations.set("settings.font.label", "الخط");
    translations.set("settings.hardwareAcceleration.label", "تسريع الأجهزة");

    const { container, getByText } = render(<AppearancePane />);

    await waitFor(() => {
      expect(container.querySelectorAll(".settings-row")).toHaveLength(3);
    });

    expect(getByText("زوايا مدورة")).toBeInTheDocument();
    expect(getByText("الخط")).toBeInTheDocument();
    expect(getByText("تسريع الأجهزة")).toBeInTheDocument();
    expect(document.documentElement.dir).toBe("rtl");
    expect(
      Array.from(container.querySelectorAll(".settings-row")).every(
        (row) => row.lastElementChild?.className === "settings-row-control",
      ),
    ).toBe(true);

    expectDeclaration(cssBlock(".settings-row"), "padding-block: 13px;");
    expectDeclaration(cssBlock(".settings-row"), "padding-inline: 16px;");
    expectDeclaration(
      cssBlock(".settings-row + .settings-row"),
      "border-block-start: 1px solid var(--border);",
    );
    expectDeclaration(
      cssBlock(".settings-row-hint"),
      "margin-block-start: 2px;",
    );
    expectDeclaration(
      cssBlock(".settings-row-control"),
      "justify-content: flex-end;",
    );
    expectDeclaration(
      cssBlock(".settings-group"),
      "container-type: inline-size;",
    );

    const narrowContainer = cssBlock("@container (max-width: 560px)");
    expectDeclaration(
      cssBlock(".settings-row", narrowContainer),
      "grid-template-columns: minmax(0, 1fr);",
    );
    expectDeclaration(
      cssBlock(".settings-row-control,\n  .settings-seg", narrowContainer),
      "justify-content: flex-start;",
    );
  });
});
