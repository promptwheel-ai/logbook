#!/usr/bin/env node
// @promptwheel/logbook-mcp — the logbook over MCP, for clients without a shell.
// Five tools wrapping the zero-dep core: digest, annotate, audit, query,
// and bounded context pages.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import {
  collectEvents, diffScan, hotspots, analyze, renderLogbookMd,
  auditHead, queryEvents, loadEvents, loadAnnotations, saveAnnotation,
  formatContextPage, sanitizeContextText,
} from "@promptwheel/logbook";

const DEFAULTS = { max: 20000, since: null, until: null };
const fileFilterSchema = z.string().min(1).max(1024).refine(
  (value) => Buffer.byteLength(value, "utf8") <= 1024,
  { message: "file filter must be at most 1024 UTF-8 bytes" },
);
function validateFileFilterCount({ file, files }) {
  if ((file ? 1 : 0) + (files?.length || 0) > 32) {
    throw new Error("at most 32 combined file filters are allowed");
  }
}
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

const server = new McpServer({ name: "logbook", version: "0.4.1" });

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
    if (!a) return { content: [{ type: "text", text: `not a commit in this repo: ${sanitizeContextText(sha, 512)}` }], isError: true };
    return { content: [{ type: "text", text: `annotated ${a.sha.slice(0, 8)} (by ${sanitizeContextText(a.by, 512)}, ${a.date}) — merged into future digests` }] };
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
      `${sanitizeContextText(x.kind, 256)}  ${sanitizeContextText(x.file, 1024)}:${x.line}  since ${x.since || "?"}${x.resilenced ? `  re-silenced x${x.resilenced} (${sanitizeContextText(x.fight, 256)})` : ""}`);
    return { content: [{ type: "text", text: lines.length ? `${live.length} live suppressions\n` + lines.join("\n") : "clean — no live suppressions in src/test/config files" }] };
  }
);

server.registerTool(
  "logbook_query",
  {
    description: "Filter the full commit-event record with precision. Start with all relevant files + event type before broad grep. Repeated paths use OR; other filters use AND. Returns up to `limit` matches, default 100, with exact counts and explicit truncation recovery.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
    repo: z.string().describe("absolute path to the git repository"),
    file: fileFilterSchema.optional().describe("legacy single substring match against files touched"),
    files: z.array(fileFilterSchema).min(1).max(32).optional().describe("file substrings; matches events touching any supplied path"),
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
    validateFileFilterCount(f);
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

server.registerTool(
  "logbook_context",
  {
    description: "Return the same filtered history order as logbook_query in compact, bounded pages for agent context. Pass all relevant paths in files; paths use OR and other filters use AND. This is deterministic delivery, not relevance ranking. Repeat identical filters with every NEXT cursor until END complete when completeness matters.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
    repo: z.string().describe("absolute path to the git repository"),
    file: fileFilterSchema.optional().describe("legacy single substring match against files touched"),
    files: z.array(fileFilterSchema).min(1).max(32).optional().describe("file substrings; matches events touching any supplied path"),
    revert: z.boolean().optional(),
    suppress: z.boolean().optional().describe("only events that added suppressions"),
    weaken: z.number().optional().describe("min net assertions removed"),
    downgrade: z.number().optional().describe("min assertion downgrades"),
    grep: z.string().optional().describe("substring match against commit subject"),
    since: z.string().optional(), until: z.string().optional(),
    cursor: z.string().min(1).optional().describe("opaque NEXT cursor from the previous page; rejects stale or changed queries"),
    },
  },
  async ({ repo: repoArg, cursor, ...filters }, extra) => {
    validateFileFilterCount(filters);
    const repo = rootOf(repoArg);
    const { events, capped, head } = pipeline(repo, progressFor(extra));
    const page = formatContextPage({
      repo,
      head,
      events,
      filters: { ...filters, max: DEFAULTS.max },
      capped,
      cursor: cursor ?? null,
    });
    return { content: [{ type: "text", text: page.text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
