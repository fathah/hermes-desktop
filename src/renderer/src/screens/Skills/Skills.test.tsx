import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// useI18n needs an I18nProvider; pass-through `t` (returns the key) keeps tests
// focused on the click → IPC contract rather than copy.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: () => {},
  }),
}));
vi.mock("../../components/AgentMarkdown", () => ({
  AgentMarkdown: ({ children }: { children: string }) => <pre>{children}</pre>,
}));

import Skills from "./Skills";

type Api = Record<string, ReturnType<typeof vi.fn>>;

/** Stub window.hermesAPI with success-returning defaults; override per test. */
function stubApi(overrides: Api = {}): Api {
  const api: Api = {
    listInstalledSkills: vi.fn().mockResolvedValue([]),
    listDisabledSkills: vi.fn().mockResolvedValue([]),
    listBundledSkills: vi.fn().mockResolvedValue([]),
    discoverLocalSkills: vi.fn().mockResolvedValue([]),
    searchSkills: vi.fn().mockResolvedValue([]),
    getSkillContent: vi.fn().mockResolvedValue(""),
    installSkill: vi.fn().mockResolvedValue({ success: true }),
    uninstallSkill: vi.fn().mockResolvedValue({ success: true }),
    setSkillEnabled: vi.fn().mockResolvedValue({ success: true }),
    createSkill: vi.fn().mockResolvedValue({ success: true }),
    writeSkillContent: vi.fn().mockResolvedValue({ success: true }),
    importLocalSkill: vi.fn().mockResolvedValue({ success: true }),
    selectFolder: vi.fn().mockResolvedValue(null),
    generateSkillFromRepo: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

const card = {
  name: "concept-diagram",
  description: "draw diagrams",
  category: "creative",
  source: "bundled",
  installed: false,
};
const installedSkill = {
  name: "guard-sop",
  category: "custom",
  description: "house rules",
  path: "/home/.hermes/skills/custom/guard-sop",
};

describe("Skills.tsx — install (issue #310)", () => {
  it("calls installSkill(name, profile) on a Browse card", async () => {
    const api = stubApi({
      listBundledSkills: vi.fn().mockResolvedValue([card]),
    });
    const view = render(<Skills />);
    await waitFor(() => expect(api.listBundledSkills).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(view.container.querySelectorAll(".skills-tab")[1]);
    });
    let btn: HTMLButtonElement | null = null;
    await waitFor(() => {
      btn = view.container.querySelector(".skills-card-install-btn");
      expect(btn).toBeTruthy();
    });
    await act(async () => fireEvent.click(btn!));
    expect(api.installSkill).toHaveBeenCalledWith("concept-diagram", undefined);
  });

  it("surfaces a CLI failure in the error banner", async () => {
    const api = stubApi({
      listBundledSkills: vi.fn().mockResolvedValue([card]),
      installSkill: vi
        .fn()
        .mockResolvedValue({ success: false, error: "No exact match for 'x'" }),
    });
    const view = render(<Skills />);
    await waitFor(() => expect(api.listBundledSkills).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(view.container.querySelectorAll(".skills-tab")[1]);
    });
    let btn: HTMLButtonElement | null = null;
    await waitFor(() => {
      btn = view.container.querySelector(".skills-card-install-btn");
      expect(btn).toBeTruthy();
    });
    await act(async () => fireEvent.click(btn!));
    await waitFor(() => {
      const banner = view.container.querySelector(".skills-error");
      expect(banner?.textContent).toContain("No exact match for");
    });
  });

  it("loads nothing when visible=false", async () => {
    const api = stubApi();
    render(<Skills visible={false} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(api.listInstalledSkills).not.toHaveBeenCalled();
  });
});

describe("Skills.tsx — authoring & management", () => {
  it("creates a skill from the New-skill modal", async () => {
    const api = stubApi();
    const view = render(<Skills />);
    await waitFor(() => expect(api.listInstalledSkills).toHaveBeenCalled());

    await act(async () => fireEvent.click(view.getByText("skills.newSkill")));
    const nameInput = view.getByPlaceholderText("skills.namePlaceholder");
    fireEvent.change(nameInput, { target: { value: "Incident SOP" } });
    await act(async () => fireEvent.click(view.getByText("skills.create")));

    expect(api.createSkill).toHaveBeenCalledTimes(1);
    expect(api.createSkill.mock.calls[0][0]).toMatchObject({
      name: "Incident SOP",
    });
  });

  it("disables an installed skill via its toggle", async () => {
    const api = stubApi({
      listInstalledSkills: vi.fn().mockResolvedValue([installedSkill]),
    });
    const view = render(<Skills />);
    await waitFor(() => expect(api.listInstalledSkills).toHaveBeenCalled());

    await act(async () => fireEvent.click(view.getByText("skills.disable")));
    expect(api.setSkillEnabled).toHaveBeenCalledWith(
      installedSkill.path,
      false,
      undefined,
    );
  });

  it("saves an edited SKILL.md from the detail panel", async () => {
    const api = stubApi({
      listInstalledSkills: vi.fn().mockResolvedValue([installedSkill]),
      getSkillContent: vi
        .fn()
        .mockResolvedValue("---\nname: guard-sop\n---\nold"),
    });
    const view = render(<Skills />);
    await waitFor(() => expect(api.listInstalledSkills).toHaveBeenCalled());

    // Open detail (click the card body), enter edit mode, change text, save.
    await act(async () =>
      fireEvent.click(view.container.querySelector(".skills-card-body")!),
    );
    await waitFor(() => expect(api.getSkillContent).toHaveBeenCalled());
    await act(async () => fireEvent.click(view.getByText("skills.edit")));
    const textarea = view.container.querySelector(
      ".skills-edit-textarea",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "new content" } });
    await act(async () => fireEvent.click(view.getByText("skills.save")));

    expect(api.writeSkillContent).toHaveBeenCalledWith(
      installedSkill.path,
      "new content",
      undefined,
    );
  });

  it("generates a draft from a repo and prefills the New-skill modal", async () => {
    const api = stubApi({
      selectFolder: vi.fn().mockResolvedValue("/some/repo"),
      generateSkillFromRepo: vi.fn().mockResolvedValue({
        success: true,
        draft: { name: "repo-skill", description: "use it", body: "Body." },
      }),
    });
    const view = render(<Skills />);
    await waitFor(() => expect(api.listInstalledSkills).toHaveBeenCalled());

    await act(async () =>
      fireEvent.click(view.getByText("skills.generateFromRepo")),
    );

    expect(api.selectFolder).toHaveBeenCalled();
    expect(api.generateSkillFromRepo).toHaveBeenCalledWith(
      "/some/repo",
      undefined,
    );
    // The authoring modal opens prefilled with the draft's name.
    await waitFor(() => {
      const nameInput = view.getByPlaceholderText(
        "skills.namePlaceholder",
      ) as HTMLInputElement;
      expect(nameInput.value).toBe("repo-skill");
    });
  });
});
