// @vitest-environment node
import { execFileSync, spawn } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it } from "vitest";
import { SSH_SESSION_DELETE_SCRIPT } from "../src/main/ssh-session-delete";

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "hermes-ssh-delete-"));
  roots.push(root);
  return root;
}
function sql(path: string, script: string): string {
  return execFileSync(
    "python3",
    [
      "-c",
      "import sqlite3,sys,json\nc=sqlite3.connect(sys.argv[1])\nc.executescript(sys.argv[2])\nprint(json.dumps(c.execute('SELECT id, parent_session_id FROM sessions ORDER BY id').fetchall()))\nc.close()",
      path,
      script,
    ],
    { encoding: "utf8" },
  ).trim();
}
function seed(root: string, profile?: string): string {
  const dir = profile ? join(root, "profiles", profile) : root;
  mkdirSync(dir, { recursive: true });
  const db = join(dir, "state.db");
  sql(
    db,
    `
    PRAGMA foreign_keys=ON;
    CREATE TABLE sessions(id TEXT PRIMARY KEY, parent_session_id TEXT REFERENCES sessions(id));
    CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT REFERENCES sessions(id), content TEXT);
    CREATE TABLE desktop_session_continuations(session_id TEXT REFERENCES sessions(id), content TEXT);
    CREATE TABLE desktop_message_attachments(session_id TEXT REFERENCES sessions(id), content TEXT);
    CREATE TABLE desktop_session_local_errors(session_id TEXT REFERENCES sessions(id), content TEXT);
    CREATE TABLE desktop_session_context_folders(session_id TEXT REFERENCES sessions(id), content TEXT);
    CREATE TABLE desktop_session_model_overrides(session_id TEXT REFERENCES sessions(id), content TEXT);
    INSERT INTO sessions VALUES ('parent',NULL),('child','parent'),('other',NULL);
    INSERT INTO messages VALUES(1,'parent','parent text'),(2,'child','keep child'),(3,'other','keep other');
    INSERT INTO desktop_session_continuations VALUES('parent','continuation');
    INSERT INTO desktop_message_attachments VALUES('parent','image');
    INSERT INTO desktop_session_local_errors VALUES('parent','error');
    INSERT INTO desktop_session_context_folders VALUES('parent','folder');
    INSERT INTO desktop_session_model_overrides VALUES('parent','model');
  `,
  );
  return db;
}
function run(
  root: string,
  sessionIds: unknown[],
  profile?: string,
): Promise<{ requested: number; deleted: number }> {
  return new Promise((resolve, reject) => {
    // Only replace home expansion in this subprocess; run the production SQL
    // and transaction code against disposable databases, never real user data.
    const prefix =
      "import os,sys\n_test_root=sys.argv[1]\n_real_expand=os.path.expanduser\nos.path.expanduser=lambda p: _test_root if p == '~/.hermes' else _real_expand(p)\n";
    const child = spawn(
      "python3",
      ["-c", prefix + SSH_SESSION_DELETE_SCRIPT, root],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr));
      else {
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stdin.end(JSON.stringify({ sessionIds, profile }));
  });
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

// @lat: [[ssh-session-delete#Selected rows and child retention]]
it("deletes selected history and overlays while preserving unselected children", async () => {
  const root = fixture();
  const db = seed(root);
  expect(await run(root, ["parent"])).toEqual({ requested: 1, deleted: 1 });
  expect(JSON.parse(sql(db, ""))).toEqual([
    ["child", null],
    ["other", null],
  ]);
  const check = execFileSync(
    "python3",
    [
      "-c",
      "import sqlite3,sys,json\nc=sqlite3.connect(sys.argv[1])\nprint(json.dumps([c.execute('SELECT session_id FROM messages ORDER BY id').fetchall(),c.execute('PRAGMA foreign_key_check').fetchall(),c.execute('SELECT COUNT(*) FROM desktop_message_attachments').fetchone()]))",
      db,
    ],
    { encoding: "utf8" },
  );
  expect(JSON.parse(check)).toEqual([[["child"], ["other"]], [], [0]]);
});

// @lat: [[ssh-session-delete#Profile isolation and idempotence]]
it("scopes deletion to the selected profile and normalizes duplicate ids", async () => {
  const root = fixture();
  const normal = seed(root);
  const named = seed(root, "research");
  expect(
    await run(root, [" parent ", "parent", "", null, "missing"], "research"),
  ).toEqual({ requested: 2, deleted: 1 });
  expect(await run(root, ["parent"], "research")).toEqual({
    requested: 1,
    deleted: 0,
  });
  expect(JSON.parse(sql(normal, ""))).toHaveLength(3);
  expect(JSON.parse(sql(named, ""))).toHaveLength(2);
});

// @lat: [[ssh-session-delete#Batch rollback]]
it("rolls back every selected deletion if a later session cannot be deleted", async () => {
  const root = fixture();
  const db = seed(root);
  sql(
    db,
    "CREATE TRIGGER reject_other BEFORE DELETE ON sessions WHEN OLD.id='other' BEGIN SELECT RAISE(ABORT,'blocked deletion'); END;",
  );
  await expect(run(root, ["parent", "other"])).rejects.toThrow(
    "blocked deletion",
  );
  expect(JSON.parse(sql(db, ""))).toEqual([
    ["child", "parent"],
    ["other", null],
    ["parent", null],
  ]);
  const count = execFileSync(
    "python3",
    [
      "-c",
      "import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nprint(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],c.execute('SELECT COUNT(*) FROM desktop_message_attachments').fetchone()[0])",
      db,
    ],
    { encoding: "utf8" },
  );
  expect(count.trim()).toBe("3 1");
});

// @lat: [[ssh-session-delete#Missing database and invalid profile]]
it("does not create an empty database or permit a profile path escape", async () => {
  const root = fixture();
  expect(await run(root, ["missing"])).toEqual({ requested: 1, deleted: 0 });
  expect(existsSync(join(root, "state.db"))).toBe(false);
  await expect(run(root, ["a"], "../escape")).rejects.toThrow(
    "Invalid Hermes profile",
  );
});

// @lat: [[ssh-session-delete#Concurrent requests]]
it("serializes concurrent deletion requests without duplicating the deleted count", async () => {
  const root = fixture();
  const db = seed(root);
  const results = await Promise.all([
    run(root, ["parent"]),
    run(root, ["parent"]),
  ]);
  expect(results.map((r) => r.deleted).sort()).toEqual([0, 1]);
  expect(JSON.parse(sql(db, ""))).toEqual([
    ["child", null],
    ["other", null],
  ]);
});

// @lat: [[ssh-session-delete#Legacy schema and opaque ids]]
it("supports legacy schemas without overlays and treats SQL-like session ids as data", async () => {
  const root = fixture();
  const db = join(root, "state.db");
  execFileSync("python3", [
    "-c",
    "import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nc.executescript('CREATE TABLE sessions(id TEXT PRIMARY KEY);CREATE TABLE messages(id INTEGER,session_id TEXT);')\nc.execute('INSERT INTO sessions VALUES(?)',(sys.argv[2],))\nc.execute('INSERT INTO sessions VALUES(?)',('keep',))\nc.commit()",
    db,
    "x'; DROP TABLE sessions; --",
  ]);
  expect(await run(root, ["x'; DROP TABLE sessions; --"])).toEqual({
    requested: 1,
    deleted: 1,
  });
  const remaining = execFileSync(
    "python3",
    [
      "-c",
      "import sqlite3,sys\nprint(sqlite3.connect(sys.argv[1]).execute('SELECT id FROM sessions').fetchone()[0])",
      db,
    ],
    { encoding: "utf8" },
  );
  expect(remaining.trim()).toBe("keep");
});
