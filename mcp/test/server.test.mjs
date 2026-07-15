// Behavioral test: drives the REAL server over stdio JSON-RPC, no SDK client.
// Guards the two integration contracts unit tests can't see:
//   1. events carry xv regardless of cache state (MCP skips the CLI entrypoint)
//   2. query never truncates silently — the count line is the contract
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
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
    writeFileSync(join(repo, i < 3 ? "a.js" : "b.js"), `let x = ${i};\n`);
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
  assert.equal(init.result.serverInfo.version, "0.4.1");
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

test("query and context accept canonical multi-file OR filters", async () => {
  const multi = await callTool("logbook_query", { repo, files: ["b.js", "a.js", "a.js"], limit: 20 });
  const [note, ...rows] = multi.split("\n");
  assert.match(note, /^5 matching events, returned 5$/);
  assert.equal(new Set(rows.map((line) => JSON.parse(line).fullSha)).size, 5);
  const mixed = await callTool("logbook_query", { repo, file: "b.js", files: ["a.js"], limit: 20 });
  assert.equal(mixed, multi, "legacy file and files array form one canonical union");

  const first = await callTool("logbook_context", { repo, files: ["b.js", "a.js"] });
  const reversed = await callTool("logbook_context", { repo, files: ["a.js", "b.js", "a.js"] });
  assert.equal(reversed, first, "file order and duplicates do not change page bytes or cursor binding");
  assert.equal([...first.matchAll(/^- ([0-9a-f]{12}) /gm)].length, 5);

  const legacy = await callTool("logbook_query", { repo, file: "a.js", limit: 20 });
  const array = await callTool("logbook_query", { repo, files: ["a.js"], limit: 20 });
  assert.equal(array, legacy, "the new array form preserves legacy scalar semantics");
});

test("multi-file schemas reject empty or oversized combined filters", async () => {
  const empty = await rpc("tools/call", {
    name: "logbook_query",
    arguments: { repo, files: [] },
  });
  assert.equal(empty.result.isError, true, "an explicit empty path set must not broaden to all events");

  const tooMany = await rpc("tools/call", {
    name: "logbook_context",
    arguments: { repo, file: "legacy.js", files: Array.from({ length: 32 }, (_, index) => `path-${index}`) },
  });
  assert.equal(tooMany.result.isError, true, "legacy scalar plus array share the 32-filter cap");

  const withinByteCap = await rpc("tools/call", {
    name: "logbook_query",
    arguments: { repo, file: "界".repeat(341) }, // 1,023 UTF-8 bytes
  });
  assert.notEqual(withinByteCap.result.isError, true, "UTF-8 byte cap accepts the boundary interior");

  const oversizedScalar = await rpc("tools/call", {
    name: "logbook_query",
    arguments: { repo, file: "界".repeat(400) }, // 1,200 UTF-8 bytes
  });
  assert.equal(oversizedScalar.result.isError, true, "legacy scalar uses the CLI's UTF-8 byte cap");

  const oversizedArrayItem = await rpc("tools/call", {
    name: "logbook_context",
    arguments: { repo, files: ["界".repeat(400)] },
  });
  assert.equal(oversizedArrayItem.result.isError, true, "array items use the CLI's UTF-8 byte cap");
});

test("release metadata requires the first multi-file core", () => {
  const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(readFileSync(join(mcpRoot, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(mcpRoot, "package-lock.json"), "utf8"));
  const listing = JSON.parse(readFileSync(join(mcpRoot, "server.json"), "utf8"));
  assert.equal(pkg.version, "0.4.1");
  assert.equal(pkg.dependencies["@promptwheel/logbook"], ">=0.8.1 <1");
  assert.equal(lock.packages[""].dependencies["@promptwheel/logbook"], ">=0.8.1 <1");
  assert.equal(listing.version, pkg.version);
  assert.equal(listing.packages[0].version, pkg.version);
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

  const empty = await rpc("tools/call", {
    name: "logbook_context",
    arguments: { repo, cursor: "" },
  });
  assert.equal(empty.result.isError, true, "an explicitly empty cursor must not restart page one");
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
  assert.match(text, /History inventory/);
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

test("MCP render paths sanitize repository evidence while query JSON stays raw", async () => {
  const isolated = mkdtempSync(join(tmpdir(), "logbook-mcp-untrusted-"));
  const env = { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io",
    GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: "h@x.io" };
  const g = (args, options = {}) => execFileSync("git", ["-C", isolated, ...args], {
    env, encoding: "utf8", ...options,
  });
  const rawSubject = "history [query](http://evil) `raw` @subject";
  const maliciousPath = "src/[path](evil)`code`.java";
  const maliciousBy = "[agent](http://evil) `model` @name";

  try {
    g(["init", "-q"]);
    mkdirSync(join(isolated, "src"), { recursive: true });
    writeFileSync(join(isolated, maliciousPath), "class Demo {\n  @Disabled\n  void flaky() {}\n}\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", rawSubject]);

    writeFileSync(join(isolated, maliciousPath), "class Demo {\n  void flaky() {}\n}\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "remove suppression"]);

    writeFileSync(join(isolated, maliciousPath), "class Demo {\n  @Disabled\n  void flaky() {}\n}\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "re-add suppression"]);

    const query = await callTool("logbook_query", { repo: isolated, limit: 20 });
    const queryEvents = query.split("\n").slice(1).map((line) => JSON.parse(line));
    assert.equal(queryEvents.find((event) => event.subject === rawSubject)?.subject, rawSubject,
      "query remains a raw machine-readable record, not a rendered view");
    assert.ok(query.includes(rawSubject), "query JSON preserves Markdown-significant subject bytes");

    const head = g(["rev-parse", "HEAD"]).trim();
    const annotated = await callTool("logbook_annotate", {
      repo: isolated, sha: head, why: "verified reason", by: maliciousBy,
    });
    assert.doesNotMatch(annotated, /\[agent\]\(http:\/\/evil\)|`model`|@name/);
    assert.match(annotated,
      /&#91;agent&#93;&#40;http&#58;\/\/evil&#41; &#96;model&#96; &#64;name/,
      "annotation confirmation renders attribution as inert evidence");
    assert.equal(JSON.parse(readFileSync(join(isolated, "annotations.jsonl"), "utf8")).by, maliciousBy,
      "sanitization is render-only; persisted annotation JSON stays raw");

    const invalidSha = "[bad](http://evil) `sha` @ref";
    const invalid = await rpc("tools/call", {
      name: "logbook_annotate",
      arguments: { repo: isolated, sha: invalidSha, why: "unused", by: "agent" },
    });
    assert.equal(invalid.result.isError, true);
    const invalidText = invalid.result.content[0].text;
    assert.doesNotMatch(invalidText, /\[bad\]\(http:\/\/evil\)|`sha`|@ref/);
    assert.match(invalidText,
      /&#91;bad&#93;&#40;http&#58;\/\/evil&#41; &#96;sha&#96; &#64;ref/,
      "invalid commit echoes are inert too");

    const audit = await callTool("logbook_audit", { repo: isolated });
    assert.match(audit, /^1 live suppression/m);
    assert.doesNotMatch(audit, /@Disabled|\[path\]\(evil\)|`code`/);
    assert.match(audit, /&#64;Disabled/,
      "Git-derived suppression kind passes through the shared sanitizer");
    assert.match(audit, /src\/&#91;path&#93;&#40;evil&#41;&#96;code&#96;\.java/,
      "Git-derived path renders literally instead of activating Markdown");
    assert.match(audit, /re-silenced x1 \([+-]+\)/,
      "the isolated fixture exercises the rendered fight-log path");
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("MCP audit neutralizes Python comment directives that could become Markdown headings", async () => {
  const isolated = mkdtempSync(join(tmpdir(), "logbook-mcp-noqa-"));
  const env = { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io",
    GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: "h@x.io" };
  const g = (args) => execFileSync("git", ["-C", isolated, ...args], {
    env, encoding: "utf8",
  });
  const rawSubject = "keep raw # noqa [query](evil)";

  try {
    g(["init", "-q"]);
    mkdirSync(join(isolated, "src"), { recursive: true });
    writeFileSync(join(isolated, "src", "check.py"), "value = unknown_name  # noqa\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", rawSubject]);

    const query = await callTool("logbook_query", { repo: isolated, limit: 20 });
    const event = query.split("\n").slice(1).map((line) => JSON.parse(line))
      .find((candidate) => candidate.subject === rawSubject);
    assert.equal(event?.subject, rawSubject,
      "adding heading protection must not sanitize query JSON");

    const audit = await callTool("logbook_audit", { repo: isolated });
    assert.match(audit, /^1 live suppression/m);
    assert.ok(!audit.includes("# noqa"), "raw directive cannot open a Markdown heading");
    assert.match(audit, /&#35; noqa/,
      "Python comment directive is displayed literally through an inert entity");
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});
