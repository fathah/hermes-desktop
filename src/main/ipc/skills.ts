import { ipcMain } from "electron";
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

  ipcMain.handle("search-skills", (_event, query: string) => {
    requireLocalWorkspace();
    return searchSkills(query);
  });
  ipcMain.handle("create-skill", (_event, input: CreateSkillInput) => {
    requireLocalWorkspace();
    return createSkill(input);
  });
  ipcMain.handle(
    "write-skill-content",
    (_event, skillPath: string, content: string, profile?: string) => {
      requireLocalWorkspace();
      return writeSkillContent(skillPath, content, profile);
    },
  );
  ipcMain.handle("list-disabled-skills", (_event, profile?: string) => {
    requireLocalWorkspace();
    return listDisabledSkills(profile);
  });
  ipcMain.handle(
    "set-skill-enabled",
    (_event, skillPath: string, enabled: boolean, profile?: string) => {
      requireLocalWorkspace();
      return setSkillEnabled(skillPath, enabled, profile);
    },
  );
  ipcMain.handle("discover-local-skills", (_event, profile?: string) => {
    requireLocalWorkspace();
    return discoverLocalSkills(profile);
  });
  ipcMain.handle(
    "import-local-skill",
    (_event, sourcePath: string, category?: string, profile?: string) => {
      requireLocalWorkspace();
      return importLocalSkill(sourcePath, category, profile);
    },
  );
  ipcMain.handle(
    "generate-skill-from-repo",
    (_event, repoPath: string, profile?: string) => {
      requireLocalWorkspace();
      return generateSkillFromRepo(repoPath, profile);
    },
  );

  // Skills Registry
  ipcMain.handle("skills-registry-sync", async (_event, profile?: string) => {
    return syncDiskSkillsToDb(profile);
  });
  ipcMain.handle(
    "skills-registry-lookup",
    async (_event, query: string, profile?: string) => {
      return lookupLocalSkill(query, profile);
    },
  );
  ipcMain.handle(
    "skills-registry-register",
    async (
      _event,
      skill: Omit<SkillEntry, "id" | "created_at">,
      profile?: string,
    ) => {
      return registerLocalSkill(skill, profile);
    },
  );
  ipcMain.handle(
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
  ipcMain.handle(
    "skills-registry-test",
    async (_event, name: string, args?: string, profile?: string) => {
      return testSkillRun(name, args, profile);
    },
  );
}
