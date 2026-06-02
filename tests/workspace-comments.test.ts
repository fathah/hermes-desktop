import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspaceComment,
  listWorkspaceComments,
  resolveWorkspaceComment,
} from "../src/main/workspace-comments";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hermes-workspace-comments-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspace comments and reminders", () => {
  it("creates, lists, and resolves local comments", async () => {
    const comment = await createWorkspaceComment(
      {
        path: "index.md",
        blockId: "block-a",
        body: "Follow up with Hermes",
        reminderAt: 123,
      },
      { root },
    );

    expect(
      (await listWorkspaceComments("index.md", { root }))[0],
    ).toMatchObject({
      id: comment.id,
      status: "open",
      reminderAt: 123,
    });

    expect(await resolveWorkspaceComment(comment.id, { root })).toMatchObject({
      status: "resolved",
    });
  });
});
