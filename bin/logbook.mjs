#!/usr/bin/env node
// @promptwheel/logbook — turn git history into memory an agent can use.
//
// Graphify maps where the code is; the logbook records what happened and why.
// Reads a repo's git history (read-only) and writes three artifacts:
//   LOGBOOK.md  — the digest a fresh agent session needs: hotspots,
//                   do-not-retry (reverts), suppression ledger, fragile areas
//   events.jsonl  — one structured event per commit (the data layer)
//   JOURNEY.md    — the repo's story, told as a hero's journey
//
// Single file. Zero dependencies. Never mutates the repo.
// Classifier lineage: the wild-rate-study scan (calibrated 12/12).

import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, join, basename } from "node:path";

// ---------- file / subject classifiers ----------
export const TEST_PAT =
  /(^|\/)(tests?|__tests__|spec|specs|fixtures?|snapshots?|__snapshots__|golden)\/|\.(test|spec)\.[jt]sx?$|_test\.(go|py|rb)$|conftest\.py$|(^|\/)(jest|vitest|playwright|cypress|karma)\.config/i;
export const CONFIG_PAT =
  /(^|\/)(\.eslintrc|eslint\.config|tsconfig[^/]*\.json|pytest\.ini|setup\.cfg|setup\.py|tox\.ini|\.rubocop|\.github\/|Dockerfile|docker-compose|vercel\.json|package\.json|Cargo\.toml|pyproject\.toml|go\.(mod|sum)|Gemfile|Rakefile|mix\.exs|composer\.json|CMakeLists\.txt|Makefile|\.pre-commit-config[^/]*|.*\.ya?ml)$/i;
export const DOC_PAT = /\.(md|txt|rst|adoc)$|(^|\/)(LICENSE|CHANGELOG|CHANGES|NEWS|AUTHORS|CONTRIBUTORS|HISTORY|COPYING)([^/]*)?$|^docs\//i;
export const GEN_PAT =
  /node_modules\/|\.map$|\.lock$|lock\.json$|\.gen\.|generated|dist\/|build\/|vendor\/|-?snapshot\.json$|\.snap$/i;
export const SUPPRESS_PAT =
  /@ts-nocheck|@ts-ignore|eslint-disable|# *noqa|# *type: *ignore|\bit\.skip\b|\btest\.skip\b|\bxit\(|\bxdescribe\(|describe\.skip|@pytest\.mark\.skip|@unittest\.skip|t\.Skip\(|except[^:]*: *pass/g;
export const ASSERT_PAT = /assert|expect\(|\.toBe|\.toEqual|t\.Error|t\.Fatal/;
export const REVERT_PAT = /revert|rollback|undo|back out/i;
export const FIX_PAT = /\bfix|resolve|repair|bug\b/i;
// The Threshold: the repo first accepting a gate (tests/CI) — the moment it got serious.
export const GATE_PAT =
  /\b(add|set ?up|introduce|first).{0,20}(test|ci|workflow|jest|vitest|pipeline|coverage|lint)|\.github\/workflows|jest\.config|vitest\.config|first release|v?1\.0\.0|initial release/i;
export const MENTOR_PAT = /claude\.md|\.claude|cursorrules|agents?\.md/i;

export function classifyFile(f) {
  if (GEN_PAT.test(f)) return "gen";
  if (DOC_PAT.test(f)) return "doc";
  if (TEST_PAT.test(f)) return "test";
  if (CONFIG_PAT.test(f)) return "config";
  return "src";
}

// ---------- git plumbing (read-only) ----------
function git(repo, args) {
  const r = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr.trim() || `git ${args[0]} failed`);
  return r.stdout;
}

function eraArgs(opts) {
  const a = [];
  if (opts.since) a.push(`--since=${opts.since}`);
  if (opts.until) a.push(`--until=${opts.until}`);
  return a;
}

// ---------- layer 1: commit events (metadata + shape) ----------
export function collectEvents(repo, opts) {
  const log = git(repo, [
    "log", `-${opts.max}`, "--no-merges", "--date=short", ...eraArgs(opts),
    "--pretty=%x1e%H%x1f%h%x1f%ad%x1f%an%x1f%s", "--numstat",
  ]);
  const events = [];
  for (const chunk of log.split("\x1e")) {
    if (!chunk.trim()) continue;
    const nl = chunk.indexOf("\n");
    const head = nl === -1 ? chunk : chunk.slice(0, nl);
    const body = nl === -1 ? "" : chunk.slice(nl + 1);
    const p = head.split("\x1f");
    if (p.length !== 5) continue;
    const [fullSha, sha, date, author, subject] = p;
    const shape = {};
    let adds = 0, dels = 0;
    for (const line of body.split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      const cls = classifyFile(m[3]);
      shape[cls] = (shape[cls] || 0) + 1;
      if (m[1] !== "-") adds += Number(m[1]);
      if (m[2] !== "-") dels += Number(m[2]);
    }
    events.push({
      sha, fullSha, date, author,
      subject: subject.slice(0, 110),
      shape, adds, dels,
      revert: REVERT_PAT.test(subject),
      fix: FIX_PAT.test(subject),
      suppressions: [], del_asserts: 0, add_asserts: 0,
    });
  }
  return events;
}

// ---------- layer 2: diff scan (suppressions + assertion deltas), one git pass ----------
export function diffScan(repo, events, opts) {
  const bySha = new Map(events.map((e) => [e.fullSha, e]));
  let patch;
  try {
    patch = git(repo, [
      "log", `-${opts.max}`, "--no-merges", ...eraArgs(opts),
      "--pretty=%x1e%H", "-p", "--unified=0",
    ]);
  } catch {
    return false; // huge repo / binary trouble: degrade to subject-level only
  }
  for (const chunk of patch.split("\x1e")) {
    if (!chunk.trim()) continue;
    const nl = chunk.indexOf("\n");
    const ev = bySha.get(chunk.slice(0, nl === -1 ? undefined : nl).trim());
    if (!ev) continue;
    const supp = new Set();
    for (const line of (nl === -1 ? "" : chunk.slice(nl + 1)).split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        for (const m of line.matchAll(SUPPRESS_PAT)) supp.add(m[0].trim());
        if (ASSERT_PAT.test(line)) ev.add_asserts++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        if (ASSERT_PAT.test(line)) ev.del_asserts++;
      }
    }
    ev.suppressions = [...supp].sort().slice(0, 6);
  }
  return true;
}

// ---------- layer 3: hotspots (name-only pass) ----------
export function hotspots(repo, opts) {
  const touches = new Map();
  const log = git(repo, [
    "log", `-${opts.max}`, "--no-merges", ...eraArgs(opts),
    "--name-only", "--pretty=%x1e",
  ]);
  for (const chunk of log.split("\x1e")) {
    for (const f of new Set(chunk.trim().split("\n").filter((l) => l && !GEN_PAT.test(l)))) {
      touches.set(f, (touches.get(f) || 0) + 1);
    }
  }
  return [...touches.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------- aggregates ----------
export function analyze(events, touched) {
  const oldest = [...events].reverse(); // oldest first
  const authors = new Map();
  for (const e of events) authors.set(e.author, (authors.get(e.author) || 0) + 1);
  const topAuthor = [...authors.entries()].sort((a, b) => b[1] - a[1])[0] || ["?", 0];

  const reverts = oldest.filter((e) => e.revert);
  const suspEvents = oldest.filter((e) => e.suppressions.length);
  const weaken = events.filter((e) => e.del_asserts > e.add_asserts + 2);

  const refix = new Map();
  for (const e of events) {
    if (!e.fix) continue;
    const key = e.subject.toLowerCase().replace(/[^a-z ]/g, "").slice(0, 40).trim();
    const docOnly = e.shape.doc && !e.shape.src && !e.shape.test;
    if (key.length > 14 && !docOnly &&
        !/^fix (typo|typos|lint|format|formatting|ci)\b/.test(key) &&
        !/typo|changelog|readme|\bdocs?\b|spelling|grammar/.test(key))
      refix.set(key, (refix.get(key) || 0) + 1);
  }
  const fragile = [...refix.entries()].sort((a, b) => b[1] - a[1]).filter(([, c]) => c >= 2).slice(0, 20);

  // journey beats
  const first = oldest[0];
  const last = oldest[oldest.length - 1];
  const threshold =
    oldest.find((e) => e.shape.test || GATE_PAT.test(e.subject)) || null;
  const mentor = oldest.find((e) => MENTOR_PAT.test(e.subject)) || null;
  const abyss = events.length ? events.reduce((a, e) => (e.dels > a.dels ? e : a)) : null;
  // Date sanity: repos in the wild contain epoch-1970 and future-dated commits
  // (broken committer clocks). Ignore them for any date arithmetic.
  const MIN_T = Date.parse("1995-01-01");
  const MAX_T = Date.now() + 86400000;
  const validDate = (d) => { const t = Date.parse(d); return t > MIN_T && t < MAX_T; };
  let winter = { days: 0, from: null, to: null };
  for (let i = 1; i < oldest.length; i++) {
    if (!validDate(oldest[i].date) || !validDate(oldest[i - 1].date)) continue;
    const gap = Math.round(
      (new Date(oldest[i].date) - new Date(oldest[i - 1].date)) / 86400000
    );
    if (gap > winter.days) winter = { days: gap, from: oldest[i - 1].date, to: oldest[i].date };
  }
  const trials = fragile.slice(0, 3);

  const dated = oldest.filter((e) => validDate(e.date));
  const spanDays = dated.length
    ? Math.max(1, Math.round((new Date(dated[dated.length - 1].date) - new Date(dated[0].date)) / 86400000))
    : 0;

  return {
    n: events.length, first, last, spanDays,
    filesTouched: touched.length,
    authors: authors.size, topAuthor,
    reverts, suspEvents, weaken, fragile,
    threshold, mentor, abyss, winter, trials,
    srcHot: touched.filter(([f]) => classifyFile(f) === "src").slice(0, 10),
    allHot: touched.slice(0, 6),
  };
}

// ---------- renderers ----------
function spanHuman(days) {
  if (days >= 365) return `${(days / 365).toFixed(1).replace(/\.0$/, "")} years`;
  if (days >= 60) return `${Math.round(days / 30)} months`;
  return `${days} days`;
}
const fmt = (x) => x.toLocaleString("en-US");

export function renderLogbookMd(name, A, shallow, capped) {
  const L = [];
  L.push(`# The Logbook of ${name}`);
  L.push(``);
  L.push(`_${fmt(A.n)} commits (${A.first?.date} → ${A.last?.date}), ${fmt(A.filesTouched)} files touched, ${A.authors} authors._`);
  if (shallow) L.push(`\n> ⚠️ Shallow clone — history is truncated. Run \`git fetch --unshallow\` for the full record.`);
  if (capped) L.push(`\n> ⚠️ Analysis capped at ${fmt(A.n)} commits (the repo has more). Re-run with \`-n <bigger>\` for the full record.`);
  L.push(``);
  L.push(`## What a fresh session should know`);
  if (A.srcHot.length)
    L.push(`- The action lives in: ${A.srcHot.slice(0, 3).map(([f, c]) => `${f} (${c})`).join(", ")}`);
  L.push(`- Dominant author: ${A.topAuthor[0]} (${A.topAuthor[1]}/${A.n})`);
  if (A.reverts.length)
    L.push(`- ${A.reverts.length} reverted approaches — check the do-not-retry list before proposing big changes`);
  if (A.fragile.length)
    L.push(`- Fragile areas (fixed 2+ times): ${A.fragile.slice(0, 3).map(([k]) => k.trim()).join("; ")}`);
  L.push(`- Oversight ledger: ${A.suspEvents.length} suppression commits, ${A.weaken.length} assertion-weakening commits`);
  L.push(``);
  L.push(`## Hotspots — source files (where the complexity lives)`);
  for (const [f, c] of A.srcHot) L.push(`- ${f} — ${c} commits`);
  L.push(``);
  L.push(`## Hotspots — all files (incl. config/docs churn)`);
  for (const [f, c] of A.allHot) L.push(`- ${f} — ${c} commits`);
  L.push(``);
  L.push(`## Do-not-retry: reverts / rollbacks (${A.reverts.length})`);
  for (const e of A.reverts.slice(0, 10)) L.push(`- ${e.date} ${e.sha} ${e.subject}`);
  L.push(``);
  L.push(`## Suppression ledger (${A.suspEvents.length} commits)`);
  for (const e of A.suspEvents.slice(0, 12))
    L.push(`- ${e.date} ${e.sha} [${e.suppressions.slice(0, 3).join(" + ")}] ${e.subject}`);
  L.push(``);
  L.push(`## Assertion-weakening events (${A.weaken.length})`);
  for (const e of A.weaken.slice(0, 10)) {
    const tag =
      e.dels > 4 * Math.max(e.adds, 1) && e.dels > 150
        ? " [large removal — likely feature/module deletion]" : "";
    L.push(`- ${e.date} ${e.sha} (-${e.del_asserts}/+${e.add_asserts})${tag} ${e.subject}`);
  }
  L.push(``);
  L.push(`## Fragile areas (same fix subject 2+ times)`);
  for (const [k, c] of A.fragile) L.push(`- ×${c}: ${k.trim()}`);
  L.push(``);
  L.push(`---`);
  L.push(`_Findings are leads, not verdicts — a suppression means "a human should look here," not misconduct. Generated read-only by [@promptwheel/logbook](https://github.com/promptwheel-ai/logbook); the logbook records, [the referee](https://github.com/promptwheel-ai/promptwheel) judges._`);
  return L.join("\n") + "\n";
}

export function journeyBeats(name, A) {
  const B = [];
  if (A.first) B.push(["I", "The Call", `${A.first.date} — "${A.first.subject.slice(0, 64)}"`, "good"]);
  if (A.threshold && A.threshold.sha !== A.first?.sha)
    B.push(["II", "The Threshold", `${A.threshold.date} — the repo accepts a gate: "${A.threshold.subject.slice(0, 64)}"`, "info"]);
  if (A.mentor)
    B.push(["III", "The Mentor", `${A.mentor.date} — "${A.mentor.subject.slice(0, 64)}"`, "info"]);
  if (A.trials.length) {
    const t = A.trials.slice(0, 2).map(([k, c]) => `${c}× "${k.trim()}"`).join("; ");
    B.push(["IV", "The Road of Trials", `the same battles, fought and re-fought: ${t}`, "odd"]);
  }
  if (A.abyss && A.abyss.dels > 100)
    B.push(["V", "The Abyss", `${A.abyss.date} — ${fmt(A.abyss.dels)} lines unmade in one stroke: "${A.abyss.subject.slice(0, 64)}"`, "bad"]);
  if (A.winter.days >= 14)
    B.push(["VI", "The Long Winter", `${A.winter.days} days of silence, ${A.winter.from} → ${A.winter.to}. the repo waited.`, "info"]);
  if (A.suspEvents.length)
    B.push(["VII", "Whispered Bargains", `${A.suspEvents.length}× a test was skipped or a warning hushed. the logbook records; the referee judges.`, "bad"]);
  if (A.reverts.length)
    B.push(["VIII", "Paths Unwalked", `${A.reverts.length} roads taken then untaken — first: "${A.reverts[0].subject.slice(0, 64)}"`, "info"]);
  if (A.last)
    B.push(["IX", "The Road Goes On", `${A.last.date} — "${A.last.subject.slice(0, 64)}". ${fmt(A.n)} commits and counting.`, "good"]);
  return B;
}

export function almanacStats(A) {
  const s = [["commits", fmt(A.n)], ["reverts", A.reverts.length], ["bargains", A.suspEvents.length]];
  if (A.abyss && A.abyss.dels > 100) s.push(["abyss", `−${fmt(A.abyss.dels)}`]);
  if (A.winter.days >= 14) s.push(["winter", `${A.winter.days}d`]);
  return s;
}

export function renderJourneyMd(name, A) {
  const L = [`# ⚔️ The Journey of ${name}`, ``, `_An epic in ${fmt(A.n)} commits, as entered in the logbook._`, ``];
  for (const [num, title, body] of journeyBeats(name, A)) L.push(`**${num}. ${title}.** ${body}`, ``);
  L.push(`---`);
  L.push(`_The Logbook Almanac_ — ` + almanacStats(A).map(([k, v]) => `${k} ${v}`).join(" · "));
  return L.join("\n") + "\n";
}

const C = process.stdout.isTTY || process.env.FORCE_COLOR
  ? { gold: "\x1b[38;5;220m", dim: "\x1b[38;5;245m", good: "\x1b[38;5;114m", info: "\x1b[38;5;44m", bad: "\x1b[38;5;203m", odd: "\x1b[38;5;177m", bold: "\x1b[1m", r: "\x1b[0m" }
  : { gold: "", dim: "", good: "", info: "", bad: "", odd: "", bold: "", r: "" };

export function renderJourneyAnsi(name, A) {
  const L = [];
  L.push(`\n  ${C.gold}${C.bold}⚔  The Journey of ${name}${C.r}`);
  L.push(`  ${C.dim}an epic in ${fmt(A.n)} commits, as entered in the logbook${C.r}`);
  for (const [num, title, body, tone] of journeyBeats(name, A))
    L.push(`\n  ${C[tone]}${C.bold}${num}. ${title}${C.r}\n  ${C.dim}${body}${C.r}`);
  const stats = almanacStats(A);
  const line = stats.map(([k, v]) => `${C.gold}${v}${C.r} ${C.dim}${k}${C.r}`).join(" · ");
  const plain = stats.map(([k, v]) => `${v} ${k}`).join(" · ");
  const w = Math.max(plain.length + 4, 42);
  L.push(`\n  ${C.gold}╭${"─".repeat(w)}╮${C.r}`);
  const title = "THE LOGBOOK ALMANAC";
  L.push(`  ${C.gold}│${C.r}  ${C.bold}${title}${C.r}${" ".repeat(w - title.length - 2)}${C.gold}│${C.r}`);
  L.push(`  ${C.gold}│${C.r}  ${line}${" ".repeat(w - plain.length - 2)}${C.gold}│${C.r}`);
  L.push(`  ${C.gold}╰${"─".repeat(w)}╯${C.r}\n`);
  return L.join("\n");
}

// ---------- CLI ----------
function usage() {
  console.log(`
  ${C.bold}logbook${C.r} — turn git history into memory an agent can use

  usage:
    logbook [path]                analyze repo → LOGBOOK.md, events.jsonl, JOURNEY.md
    logbook journey [path]        the repo's story, in color (writes nothing)
    logbook [path] --json         structured events to stdout (writes nothing)

  options:
    -n, --max N        commits to analyze (default 5000)
    --since / --until  era-scoped archaeology (git date formats)
    --out DIR          write artifacts somewhere other than the repo root
    -q, --quiet        suppress the summary
    -v, --version      print version

  The logbook records; the referee (promptwheel) judges.
`);
}

export function parseArgs(argv) {
  const o = { cmd: "run", repo: ".", max: 5000, since: null, until: null, json: false, quiet: false, out: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "journey") o.cmd = "journey";
    else if (a === "-n" || a === "--max") o.max = Number(argv[++i]);
    else if (a === "--since") o.since = argv[++i];
    else if (a === "--until") o.until = argv[++i];
    else if (a === "--json") o.json = true;
    else if (a === "-q" || a === "--quiet") o.quiet = true;
    else if (a === "--out") o.out = argv[++i];
    else if (a === "-h" || a === "--help") o.cmd = "help";
    else if (a === "-v" || a === "--version") o.cmd = "version";
    else if (!a.startsWith("-")) rest.push(a);
  }
  if (rest.length) o.repo = rest[0];
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.cmd === "help") return usage();
  if (o.cmd === "version") {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return console.log(pkg.version);
  }

  const repo = resolve(o.repo);
  if (!existsSync(join(repo, ".git")) && !existsSync(join(repo, "HEAD"))) {
    console.error(`  not a git repository: ${repo}`);
    process.exit(1);
  }
  const name = basename(repo);
  const shallow = existsSync(join(repo, ".git", "shallow"));

  if (!o.quiet && !o.json) console.log(`\n  ${C.dim}reading git history…${C.r}`);
  const events = collectEvents(repo, o);
  if (!events.length) {
    console.error("  no commits found (empty repo, or --since/--until excluded everything)");
    process.exit(1);
  }
  const capped = events.length >= o.max;
  diffScan(repo, events, o);
  const touched = hotspots(repo, o);
  const A = analyze(events, touched);

  if (o.json) {
    for (const e of events) console.log(JSON.stringify(e));
    return;
  }
  if (o.cmd === "journey") return console.log(renderJourneyAnsi(name, A));

  const outDir = o.out ? resolve(o.out) : repo;
  writeFileSync(join(outDir, "LOGBOOK.md"), renderLogbookMd(name, A, shallow, capped));
  writeFileSync(join(outDir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(join(outDir, "JOURNEY.md"), renderJourneyMd(name, A));

  if (!o.quiet) {
    console.log(`  ${fmt(A.n)} commits${capped ? ` (capped — use -n for more)` : ""} · ${fmt(A.filesTouched)} files · ${spanHuman(A.spanDays)} · ${A.authors} authors\n`);
    console.log(`  ${C.good}✓${C.r} wrote ${C.bold}LOGBOOK.md${C.r}   ${C.dim}hotspots · do-not-retry · suppression ledger${C.r}`);
    console.log(`  ${C.good}✓${C.r} wrote ${C.bold}events.jsonl${C.r}   ${C.dim}${fmt(A.n)} structured events${C.r}`);
    console.log(`  ${C.good}✓${C.r} wrote ${C.bold}JOURNEY.md${C.r}     ${C.dim}the repo's story, told back to you${C.r}\n`);
    if (shallow) console.log(`  ${C.bad}⚠${C.r} ${C.dim}shallow clone — run git fetch --unshallow for the full record${C.r}\n`);
    console.log(`  ${C.dim}next:${C.r} logbook journey   ${C.dim}(see it in color)${C.r}\n`);
  }
}

// Entry-point gate that survives npm bin symlinks (Unix) and .cmd shims +
// backslash paths (Windows): resolve argv[1] to a real path, compare as URL.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((e) => { console.error(`  logbook: ${e.message}`); process.exit(1); });
}
