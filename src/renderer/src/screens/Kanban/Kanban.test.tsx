import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ACTIVE_LOCALE,
  setLocale as setSharedLocale,
} from "../../../../shared/i18n";
import { I18nProvider } from "../../components/I18nProvider";
import Kanban from "./Kanban";

function installHermesAPI(): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getLocale: vi.fn().mockResolvedValue("zh-CN"),
      setLocale: vi.fn().mockResolvedValue("zh-CN"),
      kanbanListBoards: vi.fn().mockResolvedValue({
        success: true,
        data: [],
      }),
      kanbanListTasks: vi.fn().mockResolvedValue({
        success: true,
        data: [],
      }),
    },
  });
}

describe("Kanban", () => {
  beforeEach(() => {
    installHermesAPI();
    setSharedLocale("zh-CN");
  });

  afterEach(() => {
    setSharedLocale(DEFAULT_ACTIVE_LOCALE);
  });

  it("renders kanban chrome using the selected Chinese locale", async () => {
    render(
      <I18nProvider>
        <Kanban visible={false} />
      </I18nProvider>,
    );

    expect(await screen.findByRole("heading", { name: "看板" })).toBeVisible();
    expect(screen.getByRole("button", { name: /刷新/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /新建任务/ })).toBeVisible();
    expect(screen.getByText("待分诊")).toBeVisible();
    expect(screen.getByText("待办")).toBeVisible();
  });
});
