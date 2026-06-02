import YAML from "yaml";

export type WorkspaceDatabaseProperty = {
  type: string;
  options?: string[];
};

export type WorkspaceDatabaseView = {
  id: string;
  name: string;
  type: "table" | "board" | "list" | "gallery" | "calendar" | "timeline";
  groupBy?: string;
  hiddenProperties?: string[];
};

export type WorkspaceDatabase = {
  hermesType: "database";
  version: 1;
  title: string;
  view?: WorkspaceDatabaseView;
  views: WorkspaceDatabaseView[];
  properties: Record<string, WorkspaceDatabaseProperty>;
  items: Array<Record<string, unknown>>;
  rowPages: Record<string, string>;
};

export type WorkspaceDatabaseParseResult =
  | { ok: true; database: WorkspaceDatabase }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function viewType(value: unknown): WorkspaceDatabaseView["type"] {
  if (
    value === "board" ||
    value === "list" ||
    value === "gallery" ||
    value === "calendar" ||
    value === "timeline"
  ) {
    return value;
  }
  return "table";
}

function parseView(value: unknown, index: number): WorkspaceDatabaseView {
  if (!isRecord(value)) {
    return { id: `view-${index + 1}`, name: "Table", type: "table" };
  }
  const type = viewType(value.type);
  const name = typeof value.name === "string" ? value.name : type;
  return {
    id: typeof value.id === "string" ? value.id : `view-${index + 1}`,
    name,
    type,
    groupBy: typeof value.groupBy === "string" ? value.groupBy : undefined,
    hiddenProperties: Array.isArray(value.hiddenProperties)
      ? value.hiddenProperties.filter(
          (property): property is string => typeof property === "string",
        )
      : undefined,
  };
}

function ensureRowIds(
  items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return items.map((item, index) => ({
    ...item,
    id: typeof item.id === "string" ? item.id : `row-${index + 1}`,
  }));
}

export function parseWorkspaceDatabase(
  content: string,
): WorkspaceDatabaseParseResult {
  try {
    const parsed = YAML.parse(content);
    if (!isRecord(parsed) || parsed.hermesType !== "database") {
      return { ok: false, error: "YAML file is not a Hermes database." };
    }

    const legacyView = isRecord(parsed.view)
      ? parseView(parsed.view, 0)
      : undefined;
    const views = Array.isArray(parsed.views)
      ? parsed.views.map(parseView)
      : legacyView
        ? [legacyView]
        : [{ id: "view-1", name: "Table", type: "table" as const }];
    const items = Array.isArray(parsed.items)
      ? ensureRowIds(parsed.items.filter(isRecord).map((item) => ({ ...item })))
      : [];

    return {
      ok: true,
      database: {
        hermesType: "database",
        version: 1,
        title:
          typeof parsed.title === "string" ? parsed.title : "Untitled database",
        view: legacyView ?? views[0],
        views,
        properties: isRecord(parsed.properties)
          ? (parsed.properties as Record<string, WorkspaceDatabaseProperty>)
          : {},
        items,
        rowPages: isRecord(parsed.rowPages)
          ? (parsed.rowPages as Record<string, string>)
          : {},
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `Invalid database YAML: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

export function stringifyWorkspaceDatabase(
  database: WorkspaceDatabase,
): string {
  return YAML.stringify(database).trimEnd() + "\n";
}

export function updateWorkspaceDatabaseItem(
  database: WorkspaceDatabase,
  index: number,
  key: string,
  value: unknown,
): WorkspaceDatabase {
  return {
    ...database,
    items: database.items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [key]: value } : item,
    ),
  };
}
