import type {
  SpsBaseProposalInput,
  SpsBaseViewConfig,
  SpsBaseWorkbenchRecipeId,
  VaultProposalInput,
} from "../shared/sps-types";

export interface BaseWorkbenchRecipe {
  id: SpsBaseWorkbenchRecipeId;
  title: string;
  view: SpsBaseViewConfig["view"];
  columns: string[];
  schema?: SpsBaseViewConfig["schema"];
  filters?: SpsBaseViewConfig["filters"];
  sort?: SpsBaseViewConfig["sort"];
}

const RECIPES: Record<SpsBaseWorkbenchRecipeId, BaseWorkbenchRecipe> = {
  research: {
    id: "research",
    title: "Research library",
    view: "table",
    columns: ["title", "source", "status", "rating", "tags"],
    schema: "source",
  },
  projects: {
    id: "projects",
    title: "Active projects",
    view: "board",
    columns: ["title", "status", "prio", "assignee", "updated"],
    schema: "project",
    sort: { prop: "updated", dir: "desc" },
  },
  decisions: {
    id: "decisions",
    title: "Decision log",
    view: "table",
    columns: ["title", "status", "date", "tags"],
    schema: "decision",
  },
  people: {
    id: "people",
    title: "People",
    view: "gallery",
    columns: ["title", "organization", "tags"],
    schema: "person",
  },
  meetings: {
    id: "meetings",
    title: "Meetings",
    view: "calendar",
    columns: ["title", "date", "status", "tags"],
    schema: "meeting",
    sort: { prop: "date", dir: "desc" },
  },
  tasks: {
    id: "tasks",
    title: "Tasks",
    view: "board",
    columns: ["title", "status", "prio", "due", "assignee"],
    schema: "task",
  },
  sources: {
    id: "sources",
    title: "Sources",
    view: "table",
    columns: ["title", "source", "status", "tags"],
    schema: "source",
  },
};

export function getBaseWorkbenchRecipe(
  id: SpsBaseWorkbenchRecipeId,
): BaseWorkbenchRecipe | null {
  return RECIPES[id] ?? null;
}

export function createBaseProposalInput(
  input: SpsBaseProposalInput,
): VaultProposalInput {
  const recipe = getBaseWorkbenchRecipe(input.recipe);
  if (!recipe) throw new Error(`Unknown Base recipe: ${input.recipe}`);
  const pageId = input.pageId || `${slug(recipe.title)}-Base`;
  const base: SpsBaseViewConfig = {
    source: input.folder,
    scope: input.folder,
    view: recipe.view,
    columns: recipe.columns,
    filters: recipe.filters,
    sort: recipe.sort,
    schema: recipe.schema,
    titleProperty: "title",
  };
  const markdown = renderBasePage(recipe.title, base);
  return {
    source: "base",
    title: recipe.title,
    summary: `Create a ${recipe.title} Base over ${input.folder}.`,
    operations: [
      {
        id: `base-${pageId}`,
        kind: "create-base-page",
        pageId,
        title: recipe.title,
        markdown,
        base,
      },
    ],
  };
}

function renderBasePage(title: string, base: SpsBaseViewConfig): string {
  return [
    `# ${title}`,
    "",
    "<!-- sps:database",
    `source: ${base.scope ?? base.source ?? ""}`,
    `view: ${base.view}`,
    `columns: ${base.columns.join(", ")}`,
    base.schema ? `schema: ${base.schema}` : "",
    "-->",
  ]
    .filter(Boolean)
    .join("\n");
}

function slug(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}
