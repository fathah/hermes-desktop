import { safeHandle } from "./safe-handle";
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
  searchSkills,
  createSkill,
  writeSkillContent,
  listDisabledSkills,
  setSkillEnabled,
  discoverLocalSkills,
  importLocalSkill,
  generateSkillFromRepo,
  type CreateSkillInput,
} from "../skills";
import {
  syncDiskSkillsToDb,
  lookupLocalSkill,
  registerLocalSkill,
  scaffoldNewSkill,
  testSkillRun,
  type SkillEntry,
} from "../skills-registry";
import {
  sshListInstalledSkills,
  sshGetSkillContent,
  sshInstallSkill,
  sshUninstallSkill,
  sshListBundledSkills,
} from "../ssh-remote";
import {
  loadActiveSkill,
  unloadActiveSkill,
  listActiveSkills,
} from "../active-skills";
import { listSkillUsage } from "../skill-usage";
import { requireLocalWorkspace } from "./connection-guards";
import { registerDualHandler } from "./utility";

export function registerSkillsIpc(): void {
  // Skills
  registerDualHandler(
    "list-installed-skills",
    listInstalledSkills,
    sshListInstalledSkills,
  );
  registerDualHandler(
    "list-bundled-skills",
    listBundledSkills,
    sshListBundledSkills,
  );
  registerDualHandler("get-skill-content", getSkillContent, sshGetSkillContent);
  registerDualHandler("install-skill", installSkill, sshInstallSkill);
  registerDualHandler("uninstall-skill", uninstallSkill, sshUninstallSkill);

  safeHandle("search-skills", (_event, query: string) => {
    requireLocalWorkspace();
    return searchSkills(query);
  });
  safeHandle("create-skill", (_event, input: CreateSkillInput) => {
    requireLocalWorkspace();
    return createSkill(input);
  });
  safeHandle(
    "write-skill-content",
    (_event, skillPath: string, content: string, profile?: string) => {
      requireLocalWorkspace();
      return writeSkillContent(skillPath, content, profile);
    },
  );
  safeHandle("list-disabled-skills", (_event, profile?: string) => {
    requireLocalWorkspace();
    return listDisabledSkills(profile);
  });
  safeHandle(
    "set-skill-enabled",
    (_event, skillPath: string, enabled: boolean, profile?: string) => {
      requireLocalWorkspace();
      return setSkillEnabled(skillPath, enabled, profile);
    },
  );
  safeHandle("discover-local-skills", (_event, profile?: string) => {
    requireLocalWorkspace();
    return discoverLocalSkills(profile);
  });
  safeHandle(
    "import-local-skill",
    (_event, sourcePath: string, category?: string, profile?: string) => {
      requireLocalWorkspace();
      return importLocalSkill(sourcePath, category, profile);
    },
  );
  safeHandle(
    "generate-skill-from-repo",
    (_event, repoPath: string, profile?: string) => {
      requireLocalWorkspace();
      return generateSkillFromRepo(repoPath, profile);
    },
  );

  // Active (loaded) skills — Claude-Code-style `/skill-name`. These augment the
  // outgoing chat request the main process assembles, so they work in every
  // connection mode and need no SSH variant (the state lives here, not remote).
  safeHandle("load-skill-to-chat", (_event, name: string, profile?: string) =>
    loadActiveSkill(name, profile),
  );
  safeHandle(
    "unload-skill-from-chat",
    (_event, name: string | undefined, profile?: string) =>
      unloadActiveSkill(name, profile),
  );
  safeHandle("list-active-skills", (_event, profile?: string) =>
    listActiveSkills(profile),
  );
  safeHandle("list-skill-usage", (_event, profile?: string) =>
    listSkillUsage(profile),
  );

  // Skills Registry
  safeHandle("skills-registry-sync", async (_event, profile?: string) => {
    return syncDiskSkillsToDb(profile);
  });
  safeHandle(
    "skills-registry-lookup",
    async (_event, query: string, profile?: string) => {
      return lookupLocalSkill(query, profile);
    },
  );
  safeHandle(
    "skills-registry-register",
    async (
      _event,
      skill: Omit<SkillEntry, "id" | "created_at">,
      profile?: string,
    ) => {
      return registerLocalSkill(skill, profile);
    },
  );
  safeHandle(
    "skills-registry-scaffold",
    async (
      _event,
      name: string,
      description: string,
      code: string,
      deps: string[],
      profile?: string,
    ) => {
      return scaffoldNewSkill(name, description, code, deps, profile);
    },
  );
  safeHandle(
    "skills-registry-test",
    async (_event, name: string, args?: string, profile?: string) => {
      return testSkillRun(name, args, profile);
    },
  );
}
