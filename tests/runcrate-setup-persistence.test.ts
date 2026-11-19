// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { expect, it, vi } from "vitest";
import { displayBrandFromConfig } from "../src/renderer/src/constants";
import Setup from "../src/renderer/src/screens/Setup/Setup";

vi.mock("../src/renderer/src/components/useI18n", () => ({
  useI18n: () => ({ t: (key: string): string => key }),
}));
vi.mock("../src/renderer/src/components/common/BrandLogo", () => ({
  default: () => null,
}));

// @lat: [[provider-setup#Runcrate provider preset#Rendered setup save and reload]]
it.each(["default", "work"])(
  "saves Runcrate through real Setup and reopens profile %s",
  async (profile) => {
    const home = mkdtempSync(join(tmpdir(), "hermes-runcrate-setup-"));
    const previousAPI = Object.getOwnPropertyDescriptor(window, "hermesAPI");
    const model = "deepseek-ai/DeepSeek-V4.1-Flash";
    const endpoint = "https://api.runcrate.ai/v1";
    const originalConfig = "model:\n  provider: openai\n  default: untouched\n";
    const originalEnv = "OPENAI_API_KEY=untouched-key\n";
    const workHome = join(home, "profiles", "work");
    mkdirSync(workHome, { recursive: true });
    for (const directory of [home, workHome]) {
      writeFileSync(join(directory, "config.yaml"), originalConfig);
      writeFileSync(join(directory, ".env"), originalEnv);
    }
    vi.stubEnv("HERMES_HOME", home);
    vi.resetModules();
    try {
      const config = await import("../src/main/config");
      const api = {
        setEnv: vi.fn(async (key: string, value: string, target?: string) => {
          config.setEnvValue(key, value, target);
          return true;
        }),
        setModelConfig: vi.fn(
          async (
            provider: string,
            name: string,
            url: string,
            target?: string,
          ) => {
            config.setModelConfig(provider, name, url, target);
            return true;
          },
        ),
        openExternal: vi.fn(),
      };
      Object.defineProperty(window, "hermesAPI", {
        configurable: true,
        value: api,
      });
      const onComplete = vi.fn();
      render(createElement(Setup, { profile, onComplete }));
      fireEvent.click(screen.getByText("constants.localName"));
      fireEvent.click(screen.getByText("setup.localPresets.runcrate"));
      fireEvent.change(screen.getByPlaceholderText("sk-..."), {
        target: { value: " fixture-runcrate-key " },
      });
      fireEvent.change(
        screen.getByPlaceholderText("setup.modelNamePlaceholder"),
        {
          target: { value: model },
        },
      );
      fireEvent.click(screen.getByText("setup.continue"));
      await waitFor(() => expect(onComplete).toHaveBeenCalledExactlyOnceWith());
      expect(api.setEnv).toHaveBeenCalledExactlyOnceWith(
        "RUNCRATE_API_KEY",
        "fixture-runcrate-key",
        profile,
      );
      expect(api.setModelConfig).toHaveBeenCalledExactlyOnceWith(
        "custom",
        model,
        endpoint,
        profile,
      );
      vi.resetModules();
      const reopened = await import("../src/main/config");
      const saved = reopened.getModelConfig(profile);
      expect(saved).toEqual({ provider: "custom", model, baseUrl: endpoint });
      expect(reopened.readEnv(profile).RUNCRATE_API_KEY).toBe(
        "fixture-runcrate-key",
      );
      expect(displayBrandFromConfig(saved.provider, saved.baseUrl)).toBe(
        "runcrate",
      );
      const untouchedHome = profile === "default" ? workHome : home;
      expect(readFileSync(join(untouchedHome, "config.yaml"), "utf8")).toBe(
        originalConfig,
      );
      expect(readFileSync(join(untouchedHome, ".env"), "utf8")).toBe(
        originalEnv,
      );
    } finally {
      if (previousAPI) Object.defineProperty(window, "hermesAPI", previousAPI);
      else Reflect.deleteProperty(window, "hermesAPI");
      vi.unstubAllEnvs();
      vi.resetModules();
      rmSync(home, { recursive: true, force: true });
    }
  },
);
