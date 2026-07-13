#!/usr/bin/env node
// @promptwheel/logbook-mcp — the logbook over MCP, for clients without a shell.
// Four tools wrapping the zero-dep core: digest, annotate, audit, query.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import {
  collectEvents, diffScan, hotspots, analyze, renderLogbookMd,
  auditHead, queryEvents, loadEvents, loadAnnotations, saveAnnotation,
} from "@promptwheel/logbook";

const DEFAULTS = { max: 20000, since: null, until: null };
// Batched ledger, three layers: session memo per HEAD; disk reuse/incremental
// via loadEvents; windowed full builds that report progress (clients reset
// their timeout on progress notifications).
const cache = new Map();
// every tool call resolves to the repo ROOT — nested paths otherwise write
// artifacts (and annotations) into subdirectories and title the digest
// after the subfolder
function rootOf(repo) {
  try {
    const r = execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    if (r) return r;
  } catch { /* fall through */ }
  return repo;
}
function pipeline(repoArg, onProgress) {
  const repo = rootOf(repoArg);
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const hit = cache.get(repo);
  if (hit && hit.head === head) return hit;
  const reused = loadEvents(repo, DEFAULTS, onProgress);
  let events, capped;
  if (reused) {
    events = reused.events;
    capped = reused.capped;
  } else {
    events = collectEvents(repo, DEFAULTS);
    capped = events.capped;
    // a failed scan must surface as an error, not as a zero-suppression record
    if (!diffScan(repo, events, DEFAULTS, onProgress))
      throw new Error("diff scan failed (git log -p errored) — history record incomplete; refusing to answer from partial data");
  }
  const A = analyze(events, hotspots(repo, DEFAULTS));
  const entry = { head, events, A, capped };
  cache.set(repo, entry);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return entry;
}

function progressFor(extra) {
  const token = extra?._meta?.progressToken ?? extra?.requestMeta?.progressToken;
  if (token == null || !extra?.sendNotification) return undefined;
  return (progress, total) => extra.sendNotification({
    method: "notifications/progress",
    params: { progressToken: token, progress, total },
  }).catch(() => {});
}

const server = new McpServer({ name: "logbook", version: "0.3.6" });

server.registerTool(
  "logbook_digest",
  {
    description: "The repo's history digest: hotspots, do-not-retry reverts, suppression ledger, fragile areas, notable events, per-file history. Use when starting work in an unfamiliar repo, before a refactor or large change, or when deciding whether green tests can be trusted.",
    inputSchema: { repo: z.string().describe("absolute path to the git repository") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ repo }, extra) => {
    const { A, capped } = pipeline(repo, progressFor(extra));
    // annotations load per-call (cheap file read) so fresh whys appear without
    // invalidating the HEAD-keyed event cache
    const root = rootOf(repo);
    return { content: [{ type: "text", text: renderLogbookMd(root.split("/").pop(), A, false, capped, loadAnnotations(root)) }] };
  }
);

server.registerTool(
  "logbook_annotate",
  {
    description: "Persist WHY a commit happened (lazy enrichment). When you investigate a do-not-retry revert or a suppression — its failure mode, its cause — save the finding so the next session gets it for free instead of re-investigating. Judgments, not records: attributed and dated.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
    repo: z.string().describe("absolute path to the git repository"),
    sha: z.string().describe("the commit being explained (any unique prefix)"),
    why: z.string().describe("the inferred cause, one sentence, specific (max 400 chars)"),
    by: z.string().optional().describe("who inferred it (model/agent name)"),
    },
  },
  async ({ repo: repoArg, sha, why, by }) => {
    const repo = rootOf(repoArg);
    const a = saveAnnotation(repo, repo, { sha, why, by });
    if (!a) return { content: [{ type: "text", text: `not a commit in this repo: ${sha}` }], isError: true };
    return { content: [{ type: "text", text: `annotated ${a.sha.slice(0, 8)} (by ${a.by}, ${a.date}) — merged into future digests` }] };
  }
);

server.registerTool(
  "logbook_audit",
  {
    description: "What is STILL suppressed in HEAD and since when (blame-dated), with re-silencing fight logs. Use when asked what tests are skipped, what debt is live, or whether a suppression keeps coming back.",
    inputSchema: { repo: z.string().describe("absolute path to the git repository") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ repo }, extra) => {
    const { events } = pipeline(repo, progressFor(extra));
    const live = auditHead(rootOf(repo), events);
    const lines = live.slice(0, 40).map((x) =>
      `${x.kind}  ${x.file}:${x.line}  since ${x.since || "?"}${x.resilenced ? `  re-silenced x${x.resilenced} (${x.fight})` : ""}`);
    return { content: [{ type: "text", text: lines.length ? `${live.length} live suppressions\n` + lines.join("\n") : "clean — no live suppressions in src/test/config files" }] };
  }
);

server.registerTool(
  "logbook_query",
  {
    description: "Filter the full commit-event record with precision. Start with file + event type (for example file and revert) before broad grep. Returns up to `limit` matches, default 100, with exact counts and explicit truncation recovery.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
    repo: z.string().describe("absolute path to the git repository"),
    file: z.string().optional().describe("substring match against files touched"),
    revert: z.boolean().optional(),
    suppress: z.boolean().optional().describe("only events that added suppressions"),
    weaken: z.number().optional().describe("min net assertions removed"),
    downgrade: z.number().optional().describe("min assertion downgrades"),
    grep: z.string().optional().describe("substring match against commit subject"),
    since: z.string().optional(), until: z.string().optional(),
    limit: z.number().int().min(1).optional(),
    },
  },
  async ({ repo, ...f }, extra) => {
    const { events, capped } = pipeline(repo, progressFor(extra));
    const all = queryEvents(events, f);
    const hits = all.slice(0, f.limit ?? 100);
    const capNote = capped
      ? ` — ANALYSIS CAPPED at ${DEFAULTS.max} commits: use the CLI with -n for a larger window or --since/--until for another era`
      : "";
    // never truncate silently: the count line is the contract
    const note = `${all.length} matching event${all.length === 1 ? "" : "s"}, returned ${hits.length}` +
      (all.length > hits.length ? " — TRUNCATED: narrow with file/revert/date filters or pass a higher limit before concluding" : "");
    // Keep every line after the count/status line as JSON: existing MCP
    // consumers parse rows that way, so cap metadata belongs on line one.
    return { content: [{ type: "text", text: note + capNote + (hits.length ? "\n" + hits.map((e) => JSON.stringify(e)).join("\n") : "") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
