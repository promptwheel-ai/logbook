#!/usr/bin/env node
// @promptwheel/logbook-mcp — the logbook over MCP, for clients without a shell.
// Six tools wrapping the zero-dep core: digest, unreviewed annotation,
// reviewable drafting, audit, query, and bounded context pages.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import {
  collectEvents, diffScan, hotspots, analyze, renderLogbookMd,
  auditHead, queryEvents, loadEvents, annotateDraft,
  loadDigestNotes, saveAnnotation, refreshDigestNotes,
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

const server = new McpServer({ name: "logbook", version: "0.5.1" });

server.registerTool(
  "logbook_digest",
  {
    description: "The repo's history digest: hotspots, do-not-retry reverts, suppression ledger, fragile areas, notable events, per-file history. Use when starting work in an unfamiliar repo, before a refactor or large change, or when deciding whether green tests can be trusted.",
    inputSchema: { repo: z.string().describe("absolute path to the git repository") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ repo }, extra) => {
    const { A, capped } = pipeline(repo, progressFor(extra));
    const root = rootOf(repo);
    return { content: [{ type: "text", text: renderLogbookMd(root.split("/").pop(), A, false, capped, loadDigestNotes(root)) }] };
  }
);

server.registerTool(
  "logbook_annotate",
  {
    description: "Persist a machine-authored, explicitly unreviewed note after investigating a commit. It appears immediately in the repo digest but never enters check --diff authority. Optional quoted evidence is raw-object verified.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
    repo: z.string().describe("absolute path to the git repository"),
    sha: z.string().describe("the commit being explained (any unique prefix)"),
    why: z.string().describe("the inferred cause, one sentence, specific (max 400 chars)"),
    span: z.string().min(1).max(600).optional().describe("optional exact contiguous quote from the commit message or changed blob"),
    side: z.enum(["message", "diff"]).optional().describe("required when span is present: where the exact evidence quote occurs"),
    evidenceFile: z.string().optional().describe("required literal changed path when side=diff; omit for message"),
    by: z.string().optional().describe("who inferred it (model/agent name)"),
    },
  },
  async ({ repo: repoArg, sha, why, span, side, evidenceFile, by }) => {
    const repo = rootOf(repoArg);
    if (!span && (side || evidenceFile)) return { content: [{ type: "text", text: "side/evidenceFile require span" }], isError: true };
    if (span && (side === "diff") !== Boolean(evidenceFile)) return { content: [{ type: "text", text: side === "diff"
      ? "diff evidence requires evidenceFile"
      : "message evidence must not name evidenceFile" }], isError: true };
    const note = saveAnnotation(repo, repo, { sha, why, span, side, evidenceFile, by });
    if (note.error) return { content: [{ type: "text", text: sanitizeContextText(note.error, 700) }], isError: true };
    const refreshed = refreshDigestNotes(repo, DEFAULTS);
    if (refreshed.error) return { content: [{ type: "text", text: `saved unreviewed note ${note.sha.slice(0, 8)}, but digest refresh failed: ${sanitizeContextText(refreshed.error, 700)}` }], isError: true };
    if (note.cleanupWarning) return { content: [{ type: "text", text: `saved unreviewed note ${note.sha.slice(0, 8)} and refreshed LOGBOOK.md, but ${sanitizeContextText(note.cleanupWarning, 700)}` }], isError: true };
    return { content: [{ type: "text", text: `saved unreviewed note ${note.sha.slice(0, 8)} (recorded by ${sanitizeContextText(by || "agent", 512)}) — visible in LOGBOOK.md; never accepted or consumed by check --diff` }] };
  }
);

server.registerTool(
  "logbook_annotate_draft",
  {
    description: "Create a local, inert evidence-bearing decision card for optional human review. Only a human can promote the returned card ID into the trusted decision plane.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      repo: z.string().describe("absolute path to the git repository"),
      sha: z.string().describe("the commit being explained (any unique prefix)"),
      why: z.string().describe("the proposed decision claim, one sentence (max 400 chars)"),
      span: z.string().min(1).max(600).describe("an exact contiguous quote from the commit message or changed blob"),
      side: z.enum(["message", "diff"]).describe("where the exact evidence quote occurs"),
      evidenceFile: z.string().optional().describe("required literal changed path when side=diff; omit for message"),
      by: z.string().optional().describe("who proposed it (model/agent name)"),
    },
  },
  async ({ repo: repoArg, sha, why, span, side, evidenceFile, by }) => {
    const repo = rootOf(repoArg);
    if ((side === "diff") !== Boolean(evidenceFile)) return { content: [{ type: "text", text: side === "diff"
      ? "diff evidence requires evidenceFile" : "message evidence must not name evidenceFile" }], isError: true };
    const draft = annotateDraft(repo, { sha, why, span, side, evidenceFile, by });
    if (draft.error) return { content: [{ type: "text", text: sanitizeContextText(draft.error, 700) }], isError: true };
    return { content: [{ type: "text", text: `drafted ${draft.cardId} for ${draft.sha.slice(0, 8)} (proposed by ${sanitizeContextText(by || "agent", 512)}) — local and inert; a human may run logbook accept-draft ${draft.cardId} --by WHO` }] };
  },
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
