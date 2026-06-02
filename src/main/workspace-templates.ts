import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import YAML from "yaml";
import { getHermesHome } from "./config";

export interface WorkspaceOptions {
  profile?: string;
  root?: string;
}

export interface WorkspaceTemplateInput {
  kind: "page" | "database-row" | "button";
  title: string;
  content: string;
  properties?: Record<string, unknown>;
}

export interface WorkspaceTemplate extends WorkspaceTemplateInput {
  id: string;
  createdAt: number;
  updatedAt: number;
  builtin?: boolean;
}

const TEMPLATES_FILE = ".workspace-templates.json";

const BUILT_INS: WorkspaceTemplate[] = [
  ["Blank", ""],
  ["PRD", "# PRD\n\n## Problem\n\n## Goals\n\n## Scope\n"],
  [
    "Meeting notes",
    "# Meeting notes\n\n## Attendees\n\n## Notes\n\n## Actions\n",
  ],
  ["Bug report", "# Bug report\n\n## Expected\n\n## Actual\n\n## Repro\n"],
  ["Research note", "# Research note\n\n## Question\n\n## Findings\n"],
  ["Sprint plan", "# Sprint plan\n\n## Goals\n\n## Tasks\n\n## Risks\n"],
  [
    "Agent runbook",
    "# Agent runbook\n\n## Context\n\n## Steps\n\n## Validation\n",
  ],
  [
    "Decision log",
    "# Decision log\n\n## Decision\n\n## Options\n\n## Outcome\n",
  ],
].map(([title, content], index) => ({
  id: `builtin-${index + 1}`,
  kind: "page" as const,
  title,
  content,
  createdAt: 0,
  updatedAt: 0,
  builtin: true,
}));

function workspaceBase(options: WorkspaceOptions = {}): string {
  return join(options.root ?? getHermesHome(options.profile), "workspace");
}

function templatesPath(root: string): string {
  return join(root, TEMPLATES_FILE);
}

async function ensureWorkspace(
  options: WorkspaceOptions = {},
): Promise<string> {
  const root = workspaceBase(options);
  await mkdir(root, { recursive: true });
  return root;
}

async function readCustomTemplates(root: string): Promise<WorkspaceTemplate[]> {
  if (!existsSync(templatesPath(root))) return [];
  try {
    const parsed = JSON.parse(await readFile(templatesPath(root), "utf-8"));
    return Array.isArray(parsed) ? (parsed as WorkspaceTemplate[]) : [];
  } catch {
    return [];
  }
}

async function writeCustomTemplates(
  root: string,
  templates: WorkspaceTemplate[],
): Promise<void> {
  await writeFile(templatesPath(root), JSON.stringify(templates, null, 2));
}

export async function listWorkspaceTemplates(
  options: WorkspaceOptions = {},
): Promise<WorkspaceTemplate[]> {
  const root = await ensureWorkspace(options);
  return [...BUILT_INS, ...(await readCustomTemplates(root))];
}

export async function saveWorkspaceTemplate(
  input: WorkspaceTemplateInput,
  options: WorkspaceOptions = {},
): Promise<WorkspaceTemplate> {
  const root = await ensureWorkspace(options);
  const now = Date.now();
  const template: WorkspaceTemplate = {
    ...input,
    id: randomUUID(),
    title: input.title.trim() || "Untitled template",
    createdAt: now,
    updatedAt: now,
  };
  const templates = await readCustomTemplates(root);
  templates.push(template);
  await writeCustomTemplates(root, templates);
  return template;
}

export function renderWorkspaceButtonBlock(input: {
  label: string;
  prompt: string;
}): string {
  return YAML.stringify({
    hermesType: "button",
    label: input.label.trim() || "Run workflow",
    actions: [
      {
        type: "agentPrompt",
        prompt: input.prompt.trim(),
      },
    ],
  });
}
