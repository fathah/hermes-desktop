import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxSurface } from "./InboxSurface";

const ocr = vi.hoisted(() => ({
  ocrImageBlobToText: vi.fn(),
}));

vi.mock("../lib/ocr", () => ocr);

const vaultState = vi.hoisted(() => ({
  rows: [] as Array<{
    path: string;
    title: string;
    props: Record<string, unknown>;
    mtime: number;
  }>,
  refetch: vi.fn(),
}));

vi.mock("../hooks/useNoteIndex", () => ({
  useVaultQuery: () => vaultState,
}));

const storeState = vi.hoisted(() => ({
  ingestCommitPage: vi.fn(),
  flash: vi.fn(),
  setSurface: vi.fn(),
  importPdf: vi.fn(),
  saveStudyToWiki: vi.fn(),
  pendingInboxMode: null as "image" | null,
  clearPendingInboxMode: vi.fn(),
}));

function useStoreMock<T>(selector: (state: typeof storeState) => T): T {
  return selector(storeState);
}
useStoreMock.getState = () => storeState;

vi.mock("../store", () => ({
  useStore: useStoreMock,
}));

const api = {
  openExternal: vi.fn(),
  readObsidianFile: vi.fn(),
  writeObsidianFile: vi.fn(),
  spsExportRow: vi.fn(),
  spsPickImage: vi.fn(),
  spsReadFileBytes: vi.fn(),
  spsAssetWrite: vi.fn(),
  spsReadRow: vi.fn(),
  spsClassifyTask: vi.fn(),
  spsRouteTask: vi.fn(),
  spsTeachCapture: vi.fn(),
  spsFileAnswer: vi.fn(),
  spsListRecentScreenshots: vi.fn(),
  spsEmailMonitorGetConfig: vi.fn(),
  spsEmailMonitorGetStatus: vi.fn(),
  spsEmailMonitorRunNow: vi.fn(),
  spsEmailMonitorApplyFeedback: vi.fn(),
  spsEmailMonitorSaveConfig: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  vaultState.rows = [];
  vaultState.refetch.mockReset();
  storeState.flash.mockReset();
  storeState.clearPendingInboxMode.mockReset();
  storeState.pendingInboxMode = null;
  storeState.saveStudyToWiki.mockResolvedValue({ ok: true, pageId: "study" });
  ocr.ocrImageBlobToText.mockReset();
  ocr.ocrImageBlobToText.mockResolvedValue("Question 1 OCR text.");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
    }),
  );
  installApi();
  api.readObsidianFile.mockResolvedValue(null);
  api.openExternal.mockResolvedValue(undefined);
  api.writeObsidianFile.mockResolvedValue(true);
  api.spsExportRow.mockResolvedValue(true);
  api.spsPickImage.mockResolvedValue("/tmp/biology-page.png");
  api.spsReadFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  api.spsAssetWrite.mockResolvedValue("a".repeat(64) + ".png");
  api.spsReadRow.mockResolvedValue(
    [
      "---",
      'title: "Textbook page"',
      'source: "image"',
      'assetPath: "' + "a".repeat(64) + '.png"',
      'ocrStatus: "not-run"',
      "---",
      "",
      "![Capture](../_assets/" + "a".repeat(64) + ".png)",
    ].join("\n"),
  );
  api.spsTeachCapture.mockResolvedValue({
    kind: "chat",
    reply: ["## Answers\n\n1. Worked answer with pedagogy."],
  });
  api.spsClassifyTask.mockResolvedValue({
    route: "human",
    nagCadence: "daily",
    assigneeId: "you",
  });
  api.spsRouteTask.mockResolvedValue({
    route: "human",
    status: "todo",
    dispatched: false,
  });
  api.spsListRecentScreenshots.mockResolvedValue([]);
  api.spsEmailMonitorGetConfig.mockResolvedValue({
    accounts: [
      {
        id: "ops",
        label: "Ops inbox",
        emailAddress: "ops@example.com",
        imapHost: "imap.example.com",
        enabled: true,
        folders: ["INBOX"],
        allowSenders: [],
        allowDomains: [],
        blockSenders: [],
        blockDomains: [],
        importanceKeywords: ["roster"],
        ignoredKeywords: [],
        captureThreshold: 0.45,
        maxMessageBytes: 1048576,
        maxAttachmentBytes: 10485760,
      },
    ],
  });
  api.spsEmailMonitorGetStatus.mockResolvedValue({
    running: false,
    accounts: [
      {
        accountId: "ops",
        label: "Ops inbox",
        state: "idle",
        captured: 1,
        skipped: 2,
        errors: 0,
      },
    ],
  });
  api.spsEmailMonitorRunNow.mockResolvedValue({
    ok: true,
    captured: 1,
    skipped: 2,
    errors: 0,
  });
  api.spsEmailMonitorApplyFeedback.mockResolvedValue({
    accounts: [],
  });
  api.spsEmailMonitorSaveConfig.mockImplementation((config: unknown) =>
    Promise.resolve(config),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("InboxSurface visual captures", () => {
  it("shows email source monitor status and sends feedback actions", async () => {
    render(<InboxSurface />);

    fireEvent.click(screen.getByRole("button", { name: /sources/i }));

    expect(await screen.findByText(/email sources/i)).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Ops inbox")).toBeInTheDocument();
    expect(screen.getByText(/1 captured/i)).toBeInTheDocument();
    expect(screen.getByText(/2 skipped/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/sender rule/i), {
      target: { value: "noise@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /ignore sender/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorApplyFeedback).toHaveBeenCalledWith(
        {
          accountId: "ops",
          action: "ignore-sender",
          sender: "noise@example.com",
        },
        "default",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /check now/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorRunNow).toHaveBeenCalledWith("default");
    });
  });

  it("toggles an account's enabled flag and persists on Save changes", async () => {
    render(<InboxSurface />);
    fireEvent.click(screen.getByRole("button", { name: /sources/i }));

    const toggle = await screen.findByLabelText(/enabled/i);
    expect(toggle).toBeChecked();

    // Save is inert until an edit dirties the config.
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeDisabled();

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorSaveConfig).toHaveBeenCalledTimes(1);
    });
    const savedConfig = api.spsEmailMonitorSaveConfig.mock.calls[0][0] as {
      accounts: Array<{ id: string; enabled: boolean }>;
    };
    expect(savedConfig.accounts[0]).toMatchObject({
      id: "ops",
      enabled: false,
    });
  });

  it("adds a new account, edits it, and saves both accounts", async () => {
    render(<InboxSurface />);
    fireEvent.click(screen.getByRole("button", { name: /sources/i }));
    await screen.findByDisplayValue("Ops inbox");

    fireEvent.click(screen.getByRole("button", { name: /add account/i }));

    const addressInputs = screen.getAllByPlaceholderText(/you@example.com/i);
    expect(addressInputs).toHaveLength(2);
    fireEvent.change(addressInputs[1], {
      target: { value: "cafe@bluebop.cafe" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorSaveConfig).toHaveBeenCalledTimes(1);
    });
    const savedConfig = api.spsEmailMonitorSaveConfig.mock.calls[0][0] as {
      accounts: Array<{ emailAddress: string }>;
    };
    expect(savedConfig.accounts).toHaveLength(2);
    expect(savedConfig.accounts[1].emailAddress).toBe("cafe@bluebop.cafe");
  });

  it("removes an account and persists the smaller config", async () => {
    render(<InboxSurface />);
    fireEvent.click(screen.getByRole("button", { name: /sources/i }));
    await screen.findByDisplayValue("Ops inbox");

    fireEvent.click(screen.getByRole("button", { name: /remove account/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorSaveConfig).toHaveBeenCalledTimes(1);
    });
    const savedConfig = api.spsEmailMonitorSaveConfig.mock.calls[0][0] as {
      accounts: unknown[];
    };
    expect(savedConfig.accounts).toHaveLength(0);
  });

  it("opens image capture mode from the first-run checklist intent", async () => {
    storeState.pendingInboxMode = "image";

    render(<InboxSurface />);

    expect(
      await screen.findByRole("button", { name: /capture screen/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import from clipboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Image").closest("button")).toHaveClass("active");
    await waitFor(() => {
      expect(api.spsListRecentScreenshots).toHaveBeenCalledWith("default");
    });
    expect(storeState.clearPendingInboxMode).toHaveBeenCalledTimes(1);
  });

  it("saves a chosen image file to the Inbox without OCR or teaching", async () => {
    render(<InboxSurface />);

    fireEvent.click(screen.getByRole("button", { name: /image/i }));
    fireEvent.change(screen.getByLabelText(/image note/i), {
      target: { value: "Teach later, but save now." },
    });
    fireEvent.click(screen.getByRole("button", { name: /choose image file/i }));

    await waitFor(() => {
      expect(api.spsExportRow).toHaveBeenCalled();
    });
    const markdown = String(api.spsExportRow.mock.calls.at(-1)?.[2]);
    expect(markdown).toContain('source: "image"');
    expect(markdown).toContain('assetPath: "' + "a".repeat(64) + '.png"');
    expect(markdown).toContain('captureOrigin: "file"');
    expect(markdown).toContain('ocrStatus: "not-run"');
    expect(markdown).toContain("Teach later, but save now.");
    expect(ocr.ocrImageBlobToText).not.toHaveBeenCalled();
    expect(api.spsTeachCapture).not.toHaveBeenCalled();
  });

  it("runs OCR and Teach This only from explicit visual capture actions", async () => {
    vaultState.rows = [
      {
        path: "_inbox/cap-image.md",
        title: "Textbook page",
        props: {
          title: "Textbook page",
          source: "image",
          assetPath: "a".repeat(64) + ".png",
          ocrStatus: "not-run",
          capturedAt: 1,
        },
        mtime: 1,
      },
    ];

    render(<InboxSurface />);

    expect(api.spsTeachCapture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /extract text/i }));

    await waitFor(() => {
      expect(ocr.ocrImageBlobToText).toHaveBeenCalled();
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "_inbox",
        "cap-image",
        expect.stringContaining("## OCR Text\n\nQuestion 1 OCR text."),
        "default",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /teach this/i }));

    await waitFor(() => {
      expect(api.spsTeachCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          captureId: "cap-image",
          title: "Textbook page",
          corpusDescription: expect.stringContaining("Question 1 OCR text."),
        }),
        "default",
      );
      expect(
        screen.getByText(/worked answer with pedagogy/i),
      ).toBeInTheDocument();
    });
  });
});

describe("InboxSurface email triage surface", () => {
  function emailRow(
    path: string,
    title: string,
    props: Record<string, unknown> = {},
  ) {
    return {
      path,
      title,
      props: {
        title,
        source: "email",
        status: "unprocessed",
        capturedAt: Date.now(),
        emailAccount: "Ops inbox",
        emailAccountId: "ops",
        emailFrom: "client@bluebay.example",
        ...props,
      },
      mtime: 0,
    };
  }

  it("renders the triage chip and reason line on an email capture card", async () => {
    vaultState.rows = [
      emailRow("_inbox/cap_1.md", "Bluebay roster change", {
        triageLabel: "action",
        triageReason: 'Matched important keyword "roster".',
        triageConfidence: 0.78,
      }),
    ];
    render(<InboxSurface />);

    const chip = await screen.findByText("action");
    expect(chip.className).toContain("chip");
    expect(chip.className).toContain("p-med");
    expect(chip).toHaveAttribute("title", "Confidence 78%");
    expect(
      screen.getByText(/matched important keyword "roster"/i),
    ).toBeInTheDocument();
  });

  it("sends card-level feedback with the capture's account id and sender", async () => {
    vaultState.rows = [
      emailRow("_inbox/cap_1.md", "Bluebay roster change", {
        triageLabel: "archive",
      }),
    ];
    render(<InboxSurface />);

    fireEvent.click(await screen.findByTitle(/triage is wrong/i));
    fireEvent.click(screen.getByRole("button", { name: /^ignore sender$/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorApplyFeedback).toHaveBeenCalledWith(
        {
          accountId: "ops",
          action: "ignore-sender",
          sender: "client@bluebay.example",
        },
        "default",
      );
    });
    expect(storeState.flash).toHaveBeenCalledWith(
      expect.stringContaining("client@bluebay.example"),
    );
  });

  it("opens a draft reply for email captures", async () => {
    vaultState.rows = [emailRow("_inbox/cap_1.md", "Bluebay roster change")];
    render(<InboxSurface />);

    fireEvent.click(await screen.findByTitle(/draft reply/i));

    await waitFor(() => {
      expect(api.openExternal).toHaveBeenCalledWith(
        expect.stringMatching(
          /^mailto:client%40bluebay\.example\?subject=Re%3A\+Bluebay\+roster\+change/,
        ),
      );
    });
    expect(storeState.flash).toHaveBeenCalledWith("Draft reply opened.");
  });

  it("turns an email capture into a routed task and marks the capture processed", async () => {
    vaultState.rows = [emailRow("_inbox/cap_1.md", "Bluebay roster change")];
    api.spsReadRow.mockResolvedValueOnce(
      [
        "---",
        'title: "Bluebay roster change"',
        'source: "email"',
        'status: "unprocessed"',
        "---",
        "",
        "Please update the Friday gate roster.",
      ].join("\n"),
    );
    render(<InboxSurface />);

    fireEvent.click(await screen.findByTitle(/create task/i));

    await waitFor(() => {
      expect(api.spsRouteTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Bluebay roster change",
          body: expect.stringContaining(
            "Please update the Friday gate roster.",
          ),
        }),
        "default",
      );
    });
    expect(api.spsClassifyTask).toHaveBeenCalledWith(
      expect.stringContaining("Please update the Friday gate roster."),
      "default",
    );
    const taskWrites = api.spsExportRow.mock.calls.filter(
      (call) => call[0] === "tasks",
    );
    expect(taskWrites).toHaveLength(2);
    expect(String(taskWrites[1][2])).toContain('source: "email"');
    expect(String(taskWrites[1][2])).toContain('captureId: "cap_1"');
    expect(api.spsExportRow).toHaveBeenCalledWith(
      "_inbox",
      "cap_1",
      expect.stringContaining('status: "processed"'),
      "default",
    );
    expect(storeState.flash).toHaveBeenCalledWith("Created task from email.");
  });

  it("falls back to the account-label lookup for pre-Slice-4 captures", async () => {
    vaultState.rows = [
      emailRow("_inbox/cap_old.md", "Old capture", {
        emailAccountId: undefined,
      }),
    ];
    render(<InboxSurface />);

    fireEvent.click(await screen.findByTitle(/triage is wrong/i));
    fireEvent.click(
      screen.getByRole("button", { name: /^always capture sender$/i }),
    );

    await waitFor(() => {
      expect(api.spsEmailMonitorApplyFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: "ops" }),
        "default",
      );
    });
  });

  it("folds digest captures into a collapsible Newsletters card", async () => {
    vaultState.rows = [
      emailRow("_inbox/cap_1.md", "Roster change"),
      emailRow("_inbox/cap_n1.md", "Newsletter one", { digest: true }),
      emailRow("_inbox/cap_n2.md", "Newsletter two", { digest: true }),
    ];
    render(<InboxSurface />);

    const toggle = await screen.findByRole("button", {
      name: /newsletters \(2\)/i,
    });
    // Digest rows stay hidden until expanded; normal rows render as cards.
    expect(screen.getByText("Roster change")).toBeInTheDocument();
    expect(screen.queryByText("Newsletter one")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("Newsletter one")).toBeInTheDocument();
    expect(screen.getByText("Newsletter two")).toBeInTheDocument();
  });
});
