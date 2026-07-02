import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduledModal } from "./ScheduledModal";

const store = vi.hoisted(() => ({
  setScheduledOpen: vi.fn(),
  scheduledDraftTopic: null as string | null,
  setScheduledDraftTopic: vi.fn(),
  ingestCommitPage: vi.fn(),
  selectPage: vi.fn(),
  flash: vi.fn(),
}));

const api = vi.hoisted(() => ({
  srList: vi.fn(),
  srListPending: vi.fn(),
  listCronJobs: vi.fn(),
  getSchedulerSkips: vi.fn(),
  srTelegramStatus: vi.fn(),
  srCreate: vi.fn(),
  srDiscoverSources: vi.fn(),
  srUpdateSourcePlan: vi.fn(),
  srRunNow: vi.fn(),
  srUpdate: vi.fn(),
  srDelete: vi.fn(),
  srRemovePending: vi.fn(),
  spsAppendWikiLog: vi.fn(),
  openExternal: vi.fn(),
  onScheduledResearchUpdate: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

const telegramDocsUrl =
  "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram";

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.scheduledDraftTopic = null;
  installApi();
  api.srList.mockResolvedValue([]);
  api.srListPending.mockResolvedValue([]);
  api.listCronJobs.mockResolvedValue([]);
  api.getSchedulerSkips.mockResolvedValue({});
  api.srTelegramStatus.mockResolvedValue({
    available: false,
    reason: "missing-channel",
    message: "No configured Telegram channel was found.",
  });
  api.srCreate.mockResolvedValue({ ok: true, item: { id: "sr_1" } });
  api.onScheduledResearchUpdate.mockReturnValue(() => {});
});

describe("ScheduledModal Telegram delivery UX", () => {
  it("uses Scheduled vocabulary for the empty monitor state", async () => {
    render(<ScheduledModal />);

    expect(await screen.findByText("Scheduled")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No topic monitors yet. Add a topic above to keep a cited workspace page current — you review each update before it lands.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Scheduled Work/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Signal Brief/i)).not.toBeInTheDocument();
  });

  it("labels topic monitors and agent jobs consistently", async () => {
    api.srList.mockResolvedValue([
      {
        id: "sr_1",
        kind: "research",
        topic: "AI agent launches",
        pageId: "ai-agent-launches",
        cadence: "weekly",
        hour: 8,
        autoApply: false,
        enabled: true,
        createdAt: 1,
        lastRunAt: 0,
        lastChangeHash: "",
        cronJobId: "cron_1",
        sourceIntent: "web",
        sourcePlan: [],
      },
    ]);
    api.listCronJobs.mockResolvedValue([
      {
        id: "cron_2",
        name: "Smoke skipped job",
        schedule: "*/5 * * * *",
        prompt: "Run the smoke job.",
        state: "active",
        enabled: true,
        next_run_at: null,
        last_run_at: null,
        last_status: "skipped",
        last_error: null,
        repeat: null,
        deliver: [],
        skills: [],
        script: null,
      },
    ]);

    render(<ScheduledModal />);

    expect(await screen.findByText("Topic monitor")).toBeInTheDocument();
    expect(screen.getByText("Agent jobs (1)")).toBeInTheDocument();
    expect(screen.getByText(/runs via scheduler/i)).toBeInTheDocument();
    expect(screen.queryByText(/Signal Brief/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/runs in background/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/background jobs/i)).not.toBeInTheDocument();
  });

  it("disables Telegram push and opens setup docs when Telegram is unavailable", async () => {
    render(<ScheduledModal />);

    expect(
      await screen.findByText(
        "Telegram is not configured. Set it up before enabling push summaries.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Telegram summary")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Set up Telegram" }));

    expect(api.openExternal).toHaveBeenCalledWith(telegramDocsUrl);
  });

  it("does not submit Telegram push when Telegram is unavailable", async () => {
    render(<ScheduledModal />);

    await screen.findByText(
      "Telegram is not configured. Set it up before enabling push summaries.",
    );
    fireEvent.change(screen.getByPlaceholderText(/monitor this topic/i), {
      target: { value: "AI agent launches" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(api.srCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: "AI agent launches",
          telegramPush: false,
          telegramMode: "summary-only",
        }),
      );
    });
  });

  it("allows Telegram push when Telegram is configured", async () => {
    api.srTelegramStatus.mockResolvedValue({
      available: true,
      reason: "configured",
      message: "Telegram channel is configured.",
    });

    render(<ScheduledModal />);

    await waitFor(() => expect(api.srTelegramStatus).toHaveBeenCalled());
    const telegramToggle = screen.getByLabelText("Telegram summary");
    expect(telegramToggle).toBeEnabled();

    fireEvent.click(telegramToggle);
    fireEvent.change(screen.getByPlaceholderText(/monitor this topic/i), {
      target: { value: "AI agent launches" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(api.srCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: "AI agent launches",
          telegramPush: true,
          telegramMode: "summary-only",
        }),
      );
    });
  });
});
