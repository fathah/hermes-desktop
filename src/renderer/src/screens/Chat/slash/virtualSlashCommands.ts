import type { SlashCommand } from "../slashCommands";

export const SLASH_COMMAND_ROW_HEIGHT = 52;
export const SLASH_COMMAND_GROUP_HEIGHT = 28;
export const SLASH_COMMAND_OVERSCAN = 4;
export const SLASH_COMMAND_VIEWPORT_HEIGHT = 420;

interface SlashCommandGroupRow {
  kind: "group";
  category: SlashCommand["category"];
  top: number;
  height: number;
}

interface SlashCommandItemRow {
  kind: "command";
  command: SlashCommand;
  commandIndex: number;
  top: number;
  height: number;
}

export type SlashCommandVirtualRow = SlashCommandGroupRow | SlashCommandItemRow;

export interface SlashCommandVirtualLayout {
  rows: SlashCommandVirtualRow[];
  commandTops: number[];
  totalHeight: number;
}

export function createSlashCommandVirtualLayout(
  commands: SlashCommand[],
): SlashCommandVirtualLayout {
  const rows: SlashCommandVirtualRow[] = [];
  const commandTops: number[] = [];
  const groups = new Map<
    SlashCommand["category"],
    Array<{ command: SlashCommand; commandIndex: number }>
  >();
  let top = 0;

  commands.forEach((command, commandIndex) => {
    const group = groups.get(command.category) ?? [];
    group.push({ command, commandIndex });
    groups.set(command.category, group);
  });

  groups.forEach((group, category) => {
    rows.push({
      kind: "group",
      category,
      top,
      height: SLASH_COMMAND_GROUP_HEIGHT,
    });
    top += SLASH_COMMAND_GROUP_HEIGHT;

    group.forEach(({ command, commandIndex }) => {
      commandTops[commandIndex] = top;
      rows.push({
        kind: "command",
        command,
        commandIndex,
        top,
        height: SLASH_COMMAND_ROW_HEIGHT,
      });
      top += SLASH_COMMAND_ROW_HEIGHT;
    });
  });

  return { rows, commandTops, totalHeight: top };
}

export function getVisibleSlashCommandRows(
  layout: SlashCommandVirtualLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan = SLASH_COMMAND_OVERSCAN,
): SlashCommandVirtualRow[] {
  const { rows } = layout;
  if (rows.length === 0) return [];

  const safeViewportHeight =
    viewportHeight > 0 ? viewportHeight : SLASH_COMMAND_VIEWPORT_HEIGHT;
  const overscanPixels = overscan * SLASH_COMMAND_ROW_HEIGHT;
  const visibleStart = Math.max(0, scrollTop - overscanPixels);
  const visibleEnd = scrollTop + safeViewportHeight + overscanPixels;

  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const row = rows[middle];
    if (row.top + row.height < visibleStart) low = middle + 1;
    else high = middle;
  }

  const visibleRows: SlashCommandVirtualRow[] = [];
  for (let index = low; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.top > visibleEnd) break;
    visibleRows.push(row);
  }
  return visibleRows;
}

export function getSlashCommandScrollTop(
  commandTop: number,
  currentScrollTop: number,
  viewportHeight: number,
): number {
  const safeViewportHeight =
    viewportHeight > 0 ? viewportHeight : SLASH_COMMAND_VIEWPORT_HEIGHT;
  const commandBottom = commandTop + SLASH_COMMAND_ROW_HEIGHT;

  if (commandTop < currentScrollTop) return commandTop;
  if (commandBottom > currentScrollTop + safeViewportHeight) {
    return commandBottom - safeViewportHeight;
  }
  return currentScrollTop;
}
