export type WorkspaceBlockType =
  | "paragraph"
  | "heading"
  | "todo"
  | "toggle"
  | "callout"
  | "quote"
  | "code";

interface MarkdownBlock {
  id: string;
  marker: string;
  body: string;
}

const BLOCK_MARKER_RE = /^<!-- hermes-block:([a-zA-Z0-9_-]+) -->$/;

function nextBlockId(index: number): string {
  return `block-${index + 1}`;
}

function parseBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const chunks = content.trim().split(/\n{2,}/);
  let generated = 0;
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const markerMatch = lines[0]?.match(BLOCK_MARKER_RE);
    const id = markerMatch?.[1] ?? nextBlockId(generated);
    const marker = `<!-- hermes-block:${id} -->`;
    const body = markerMatch ? lines.slice(1).join("\n").trim() : chunk.trim();
    if (!body) continue;
    blocks.push({ id, marker, body });
    generated += 1;
  }
  return blocks;
}

function stringifyBlocks(blocks: MarkdownBlock[]): string {
  return blocks.map((block) => `${block.marker}\n${block.body}`).join("\n\n");
}

export function ensureMarkdownBlockIds(content: string): string {
  return stringifyBlocks(parseBlocks(content));
}

export function duplicateBlockById(content: string, id: string): string {
  const blocks = parseBlocks(content);
  const index = blocks.findIndex((block) => block.id === id);
  if (index === -1) return ensureMarkdownBlockIds(content);
  const copyId = `${id}-copy`;
  blocks.splice(index + 1, 0, {
    id: copyId,
    marker: `<!-- hermes-block:${copyId} -->`,
    body: blocks[index].body,
  });
  return stringifyBlocks(blocks);
}

export function deleteBlockById(content: string, id: string): string {
  return stringifyBlocks(
    parseBlocks(content).filter((block) => block.id !== id),
  );
}

function stripBlockSyntax(body: string): string {
  return body
    .replace(/^#{1,6}\s+/, "")
    .replace(/^-\s+\[[ xX]\]\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^```\n/, "")
    .replace(/\n```$/, "")
    .trim();
}

function bodyForType(body: string, type: WorkspaceBlockType): string {
  const plain = stripBlockSyntax(body);
  if (type === "heading") return `## ${plain}`;
  if (type === "todo") return `- [ ] ${plain}`;
  if (type === "toggle") return `### ${plain}`;
  if (type === "callout" || type === "quote") return `> ${plain}`;
  if (type === "code") return `\`\`\`\n${plain}\n\`\`\``;
  return plain;
}

export function turnBlockInto(
  content: string,
  id: string,
  type: WorkspaceBlockType,
): string {
  const blocks = parseBlocks(content);
  return stringifyBlocks(
    blocks.map((block) =>
      block.id === id
        ? { ...block, body: bodyForType(block.body, type) }
        : block,
    ),
  );
}

export function extractWorkspacePageLinks(content: string): string[] {
  const links = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const target = match[1]?.trim();
    if (target) links.add(target);
  }
  return [...links];
}
