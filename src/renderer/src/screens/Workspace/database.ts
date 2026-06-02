import YAML from "yaml";

export type WorkspaceDatabaseProperty = {
  type:
    | "title"
    | "text"
    | "number"
    | "select"
    | "multi_select"
    | "status"
    | "date"
    | "checkbox"
    | "url"
    | "email"
    | "phone"
    | "relation"
    | "rollup"
    | "formula"
    | "files"
    | "button"
    | "unique_id"
    | string;
  options?: string[];
};

export type WorkspaceDatabaseFilter = {
  property: string;
  operator: "equals" | "contains" | "isNotEmpty" | "isEmpty";
  value?: unknown;
};

export type WorkspaceDatabaseFilterGroup = {
  operator: "and" | "or";
  filters: WorkspaceDatabaseFilter[];
};

export type WorkspaceDatabaseSort = {
  property: string;
  direction: "asc" | "desc";
};

export type WorkspaceDatabaseView = {
  id: string;
  name: string;
  type: "table" | "board" | "list" | "gallery" | "calendar" | "timeline";
  groupBy?: string;
  subGroupBy?: string;
  hiddenProperties?: string[];
  filters?: WorkspaceDatabaseFilterGroup;
  sorts?: WorkspaceDatabaseSort[];
  openMode?: "side" | "center" | "full";
};

export type WorkspaceDatabase = {
  hermesType: "database";
  version: 2;
  id: string;
  title: string;
  view?: WorkspaceDatabaseView;
  views: WorkspaceDatabaseView[];
  properties: Record<string, WorkspaceDatabaseProperty>;
  items: Array<Record<string, unknown>>;
  rowPages: Record<string, string>;
  templates: Array<Record<string, unknown>>;
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

function openMode(value: unknown): WorkspaceDatabaseView["openMode"] {
  if (value === "center" || value === "full") return value;
  return "side";
}

function parseSort(value: unknown): WorkspaceDatabaseSort | null {
  if (!isRecord(value) || typeof value.property !== "string") return null;
  return {
    property: value.property,
    direction: value.direction === "desc" ? "desc" : "asc",
  };
}

function parseFilter(value: unknown): WorkspaceDatabaseFilter | null {
  if (!isRecord(value) || typeof value.property !== "string") return null;
  const operator =
    value.operator === "contains" ||
    value.operator === "isNotEmpty" ||
    value.operator === "isEmpty"
      ? value.operator
      : "equals";
  return {
    property: value.property,
    operator,
    value: value.value,
  };
}

function parseFilters(value: unknown): WorkspaceDatabaseFilterGroup | undefined {
  if (!isRecord(value) || !Array.isArray(value.filters)) return undefined;
  return {
    operator: value.operator === "or" ? "or" : "and",
    filters: value.filters.map(parseFilter).filter((filter) => filter !== null),
  };
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
    subGroupBy:
      typeof value.subGroupBy === "string" ? value.subGroupBy : undefined,
    hiddenProperties: Array.isArray(value.hiddenProperties)
      ? value.hiddenProperties.filter(
          (property): property is string => typeof property === "string",
        )
      : undefined,
    filters: parseFilters(value.filters),
    sorts: Array.isArray(value.sorts)
      ? value.sorts.map(parseSort).filter((sort) => sort !== null)
      : undefined,
    openMode: isRecord(value) && value.openMode ? openMode(value.openMode) : undefined,
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

function databaseId(value: unknown, title: string): string {
  if (typeof value === "string" && value.trim()) return value;
  return `db-${title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled"}`;
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
        version: 2,
        id: databaseId(parsed.id, String(parsed.title ?? "Untitled database")),
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
        templates: Array.isArray(parsed.templates)
          ? parsed.templates.filter(isRecord)
          : [],
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

function matchesFilter(
  item: Record<string, unknown>,
  filter: WorkspaceDatabaseFilter,
): boolean {
  const value = item[filter.property];
  if (filter.operator === "isNotEmpty") {
    return value !== undefined && value !== null && String(value) !== "";
  }
  if (filter.operator === "isEmpty") {
    return value === undefined || value === null || String(value) === "";
  }
  if (filter.operator === "contains") {
    return String(value ?? "")
      .toLowerCase()
      .includes(String(filter.value ?? "").toLowerCase());
  }
  return String(value ?? "") === String(filter.value ?? "");
}

function compareValues(
  a: unknown,
  b: unknown,
  direction: WorkspaceDatabaseSort["direction"],
): number {
  const aNumber = typeof a === "number" ? a : Number(a);
  const bNumber = typeof b === "number" ? b : Number(b);
  const result =
    Number.isFinite(aNumber) && Number.isFinite(bNumber)
      ? aNumber - bNumber
      : String(a ?? "").localeCompare(String(b ?? ""));
  return direction === "desc" ? -result : result;
}

export function applyWorkspaceDatabaseView(
  database: WorkspaceDatabase,
  view: WorkspaceDatabaseView,
): Array<Record<string, unknown>> {
  let items = [...database.items];
  if (view.filters && view.filters.filters.length > 0) {
    items = items.filter((item) => {
      const checks = view.filters!.filters.map((filter) =>
        matchesFilter(item, filter),
      );
      return view.filters!.operator === "or"
        ? checks.some(Boolean)
        : checks.every(Boolean);
    });
  }
  for (const sort of [...(view.sorts ?? [])].reverse()) {
    items.sort((a, b) =>
      compareValues(a[sort.property], b[sort.property], sort.direction),
    );
  }
  return items;
}
