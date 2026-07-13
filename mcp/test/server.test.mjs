// Behavioral test: drives the REAL server over stdio JSON-RPC, no SDK client.
// Guards the two integration contracts unit tests can't see:
//   1. events carry xv regardless of cache state (MCP skips the CLI entrypoint)
//   2. query never truncates silently — the count line is the contract
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");

let repo, child, buf = "";
const pending = new Map();
let nextId = 1;

function rpc(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`rpc timeout: ${method}`)); }, 60000).unref();
  });
}
const callTool = async (name, args) => {
  const r = await rpc("tools/call", { name, arguments: args });
  return r.result.content[0].text;
};

before(() => {
  repo = mkdtempSync(join(tmpdir(), "logbook-mcp-"));
  const g = (args) => execFileSync("git", ["-C", repo, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: "h@x.io" } });
  g(["init", "-q"]);
  // 105 events: a few real file commits (diff shape), the bulk empty (fast)
  for (let i = 0; i < 5; i++) {
    writeFileSync(join(repo, "a.js"), `let x = ${i};\n`);
    g(["add", "-A"]); g(["commit", "-q", "-m", `c${i}`]);
  }
  for (let i = 5; i < 105; i++) g(["commit", "-q", "--allow-empty", "-m", `c${i}`]);
  child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
  child.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const resolve = pending.get(msg.id);
      if (resolve) { pending.delete(msg.id); resolve(msg); }
    }
  });
});
after(() => { child?.kill(); rmSync(repo, { recursive: true, force: true }); });

test("handshake and tool inventory", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "behavioral-test", version: "0.0.0" } });
  assert.equal(init.result.serverInfo.name, "logbook");
  assert.equal(init.result.serverInfo.version, "0.4.0");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tools = await rpc("tools/list", {});
  assert.deepEqual(tools.result.tools.map((t) => t.name).sort(),
    ["logbook_annotate", "logbook_audit", "logbook_context", "logbook_digest", "logbook_query"]);
});

test("fresh query (no ledger on disk): events carry xv, truncation is announced", async () => {
  const text = await callTool("logbook_query", { repo });
  const [note, ...rows] = text.split("\n");
  assert.match(note, /^105 matching events, returned 100 — TRUNCATED/, "count line is the contract");
  assert.equal(rows.length, 100);
  for (const r of rows) {
    const e = JSON.parse(r);
    assert.equal(typeof e.xv, "number", "library-path events are stamped");
  }
});

test("raised limit returns everything, no truncation notice", async () => {
  const text = await callTool("logbook_query", { repo, limit: 200 });
  const [note, ...rows] = text.split("\n");
  assert.match(note, /^105 matching events, returned 105$/);
  assert.equal(rows.length, 105);
});

test("context traverses the raw query order exactly in bounded pages", async () => {
  const raw = (await callTool("logbook_query", { repo, limit: 200 }))
    .split("\n").slice(1).map((line) => JSON.parse(line).fullSha.slice(0, 12));
  const seen = [];
  let cursor;
  let pages = 0;
  do {
    const text = await callTool("logbook_context", { repo, ...(cursor ? { cursor } : {}) });
    assert.ok(Buffer.byteLength(text) <= 8192, "MCP context page obeys the byte cap");
    const rows = [...text.matchAll(/^- ([0-9a-f]{12}) /gm)].map((match) => match[1]);
    assert.ok(rows.length <= 20, "MCP context page obeys the item cap");
    seen.push(...rows);
    const next = text.match(/^NEXT (\S+)$/m);
    cursor = next?.[1];
    if (!cursor) assert.match(text, /^END complete$/m);
    pages += 1;
    assert.ok(pages < 20, "cursor traversal terminates");
  } while (cursor);
  assert.deepEqual(seen, raw, "compact traversal neither reorders nor drops raw query events");
});

test("context rejects tampered cursors", async () => {
  const first = await callTool("logbook_context", { repo });
  const cursor = first.match(/^NEXT (\S+)$/m)?.[1];
  assert.ok(cursor, "fixture produces another page");
  const r = await rpc("tools/call", {
    name: "logbook_context",
    arguments: { repo, cursor: cursor.slice(0, -1) + (cursor.endsWith("A") ? "B" : "A") },
  });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /invalid or stale cursor/i);
});

test("invalid query limits fail validation instead of slicing strangely", async () => {
  const r = await rpc("tools/call", { name: "logbook_query", arguments: { repo, limit: 0 } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /limit|greater than or equal to 1/i);
});

test("query after a CLI-written ledger: identical schema (cache-invariant)", async () => {
  const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@promptwheel", "logbook", "bin", "logbook.mjs");
  execFileSync(process.execPath, [CLI, repo, "-q"], { encoding: "utf8" });
  // new HEAD-keyed session memo is warm; force a fresh pipeline via a new commit
  execFileSync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "tick"], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: "h@x.io" } });
  const text = await callTool("logbook_query", { repo, grep: "c1", limit: 200 });
  const rows = text.split("\n").slice(1).map((l) => JSON.parse(l));
  assert.ok(rows.length > 0);
  assert.ok(rows.every((e) => typeof e.xv === "number"), "ledger-path events carry xv too");
});

test("digest renders through the same pipeline", async () => {
  const text = await callTool("logbook_digest", { repo });
  assert.match(text, /The Logbook of/);
  assert.match(text, /Historical signal/);
});

test("audit on the clean fixture reports clean, not an error", async () => {
  const text = await callTool("logbook_audit", { repo });
  assert.match(text, /clean — no live suppressions/);
});

test("context cursor is rejected after repository HEAD changes", async () => {
  const first = await callTool("logbook_context", { repo });
  const cursor = first.match(/^NEXT (\S+)$/m)?.[1];
  assert.ok(cursor, "fixture produces another page");
  execFileSync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "context-head-change"], {
    env: { ...process.env, GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io",
      GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: "h@x.io" },
  });
  const r = await rpc("tools/call", { name: "logbook_context", arguments: { repo, cursor } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /invalid or stale cursor/i);
});
