#!/usr/bin/env node
// @promptwheel/logbook-mcp — the logbook over MCP, for clients without a shell.
// Three tools wrapping the zero-dep core: digest, audit, query.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import {
  collectEvents, diffScan, hotspots, analyze, renderLogbookMd,
  auditHead, queryEvents, loadEvents,
} from "@promptwheel/logbook";

const DEFAULTS = { max: 20000, since: null, until: null };
// Batched ledger, three layers: session memo per HEAD; disk reuse/incremental
// via loadEvents; windowed full builds that report progress (clients reset
// their timeout on progress notifications).
const cache = new Map();
function pipeline(repo, onProgress) {
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const hit = cache.get(repo);
  if (hit && hit.head === head) return hit;
  const reused = loadEvents(repo, DEFAULTS, onProgress);
  let events;
  if (reused) {
    events = reused.events;
  } else {
    events = collectEvents(repo, DEFAULTS);
    diffScan(repo, events, DEFAULTS, onProgress);
  }
  const A = analyze(events, hotspots(repo, DEFAULTS));
  const entry = { head, events, A };
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

const server = new McpServer({ name: "logbook", version: "0.1.0" });

server.tool(
  "logbook_digest",
  "The repo's history digest: hotspots, do-not-retry reverts, suppression ledger, fragile areas, notable events, per-file history. Use when starting work in an unfamiliar repo, before a refactor or large change, or when deciding whether green tests can be trusted.",
  { repo: z.string().describe("absolute path to the git repository") },
  async ({ repo }, extra) => {
    const { A } = pipeline(repo, progressFor(extra));
    return { content: [{ type: "text", text: renderLogbookMd(repo.split("/").pop(), A, false, A.n >= DEFAULTS.max) }] };
  }
);

server.tool(
  "logbook_audit",
  "What is STILL suppressed in HEAD and since when (blame-dated), with re-silencing fight logs. Use when asked what tests are skipped, what debt is live, or whether a suppression keeps coming back.",
  { repo: z.string().describe("absolute path to the git repository") },
  async ({ repo }, extra) => {
    const { events } = pipeline(repo, progressFor(extra));
    const live = auditHead(repo, events);
    const lines = live.slice(0, 40).map((x) =>
      `${x.kind}  ${x.file}:${x.line}  since ${x.since || "?"}${x.resilenced ? `  re-silenced x${x.resilenced} (${x.fight})` : ""}`);
    return { content: [{ type: "text", text: lines.length ? `${live.length} live suppressions\n` + lines.join("\n") : "clean — no live suppressions in src/test/config files" }] };
  }
);

server.tool(
  "logbook_query",
  "Filter the full commit-event record with precision (the digest truncates; this does not). Use for completeness questions: every revert touching a file, all assertion-weakening events since a date, etc.",
  {
    repo: z.string().describe("absolute path to the git repository"),
    file: z.string().optional().describe("substring match against files touched"),
    revert: z.boolean().optional(),
    suppress: z.boolean().optional().describe("only events that added suppressions"),
    weaken: z.number().optional().describe("min net assertions removed"),
    downgrade: z.number().optional().describe("min assertion downgrades"),
    grep: z.string().optional().describe("substring match against commit subject"),
    since: z.string().optional(), until: z.string().optional(),
    limit: z.number().optional(),
  },
  async ({ repo, ...f }, extra) => {
    const { events } = pipeline(repo, progressFor(extra));
    const hits = queryEvents(events, f).slice(0, f.limit || 100);
    return { content: [{ type: "text", text: hits.map((e) => JSON.stringify(e)).join("\n") || "no matching events" }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
