#!/usr/bin/env node
// @promptwheel/logbook — turn git history into memory an agent can use.
//
// Nobody reads the git history: it's too big, and skimming a slice gives a
// wrong picture. Code maps say where things are; nothing says what happened.
// This mines a repo's git history (read-only, newest 20k commits by default)
// and writes three artifacts:
//   LOGBOOK.md  — the digest a fresh agent session needs: hotspots,
//                   do-not-retry (reverts), suppression ledger, fragile areas
//   events.jsonl  — one structured event per commit (the data layer)
//   JOURNEY.md    — the repo's story, told as a hero's journey
//
// Single file. Zero dependencies. Never mutates the repo.
// Classifier lineage: the wild-rate-study scan (calibrated 12/12).

import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, realpathSync, readFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, join, basename } from "node:path";

// ---------- file / subject classifiers ----------
export const TEST_PAT =
  /(^|\/)(tests?|__tests__|spec|specs|fixtures?|snapshots?|__snapshots__|golden)\/|\.(test|spec)\.[jt]sx?$|_test\.(go|py|rb)$|conftest\.py$|(^|\/)(jest|vitest|playwright|cypress|karma)\.config/i;
export const CONFIG_PAT =
  /(^|\/)(\.eslintrc|eslint\.config|tsconfig[^/]*\.json|pytest\.ini|setup\.cfg|setup\.py|tox\.ini|\.rubocop|\.github\/|Dockerfile|docker-compose|vercel\.json|package\.json|Cargo\.toml|lerna\.json|nx\.json|turbo\.json|rush\.json|\.babelrc|babel\.config[^/]*|bower\.json|deno\.json[c]?|pyproject\.toml|go\.(mod|sum)|Gemfile|Rakefile|mix\.exs|composer\.json|CMakeLists\.txt|Makefile|\.pre-commit-config[^/]*|.*\.ya?ml|[^/]+\.config\.[cm]?[jt]s|\.[^/]+)$/i;
export const DOC_PAT = /\.(md|txt|rst|adoc)$|(^|\/)(LICENSE|CHANGELOG|CHANGES|NEWS|AUTHORS|CONTRIBUTORS|HISTORY|COPYING)([^/]*)?$|^docs\//i;
export const GEN_PAT =
  /node_modules\/|\.map$|\.lock$|lock\.json$|\.gen\.|generated|dist\/|build\/|vendor\/|-?snapshot\.json$|\.snap$|(^|\/)next-env\.d\.ts$/i;
// Bump whenever detector precision changes: a cached events.jsonl written by
// an older extractor must trigger a full rebuild, not survive the upgrade.
// (4: event paths are complete, not a six-path display sample, so --file
// queries cannot silently miss wide commits)
export const EXTRACTOR_VERSION = 4;
// Default commit window (-n/--max). The ledger cache is only trusted at this
// cap (or when it reaches a root commit), so the two sites must agree.
export const DEFAULT_MAX = 20000;
export const SUPPRESS_PAT =
  /@ts-nocheck|@ts-ignore|eslint-disable|# *noqa|# *type: *ignore|\bit\.skip\b|\btest\.skip\b|\bxit\(|\bxdescribe\(|describe\.skip\b|@pytest\.mark\.skip\b|@unittest\.skip\b|\bt\.Skip\(|@Disabled\b|@Ignore\b|\[Ignore\b|Skip\s*=\s*"|#\[ignore|markTestSkipped\(|markTestIncomplete\(|except[^:]*: *pass/g;
export const ASSERT_PAT = /assert|expect\(|\.toBe|\.toEqual|t\.Error|t\.Fatal/;
// Assertion strength (for downgrade detection): exact/behavioral vs existence/truthy.
export const STRONG_ASSERT_PAT = /\.toStrictEqual\(|\.toEqual\(|\.toBe\(|\.toMatchObject\(|\.toThrow\([^)]|assertEqual\(|assertIs\(|assertRaises\([^)]/;
export const WEAK_ASSERT_PAT = /\.toBeTruthy\(|\.toBeFalsy\(|\.toBeDefined\(|\.toBeUndefined\(|not\.toThrow\(\)|\.toHaveBeenCalled\(\)|assertTrue\(|assertIsNotNone\(/;
export const REVERT_PAT = /revert|rollback|undo|back out/i;
export const FIX_PAT = /\bfix|resolve|repair|bug\b/i;
// The Threshold: the repo first accepting a gate (tests/CI) — the moment it got serious.
export const GATE_PAT =
  /\b(add|set ?up|introduce|first).{0,20}(test|ci|workflow|jest|vitest|pipeline|coverage|lint)|\.github\/workflows|jest\.config|vitest\.config|first release|v?1\.0\.0|initial release/i;
export const MENTOR_PAT = /claude\.md|\.claude|cursorrules|agents?\.md/i;

// A suppression directive only functions in a comment or as call syntax.
// Inside a quoted string or regex-source it is a MENTION (pattern tables,
// test fixtures, docs generators) — not a live directive. Approximate but
// sound for directives: count unescaped quote chars before the match.
// Directives that only function INSIDE a comment; every other idiom is call
// or annotation syntax, so a match sitting after a comment opener is prose
// ("// don't use describe.skip here"), not a live suppression.
const COMMENT_DIRECTIVE = /@ts-nocheck|@ts-ignore|eslint-disable|noqa|type: *ignore/;
export function isMention(line, idx, kind) {
  let sq = 0, dq = 0, bt = 0;
  for (let i = 0; i < idx; i++) {
    const c = line[i];
    if (c === "\\") { i++; continue; }
    if (c === "'") sq++;
    else if (c === '"') dq++;
    else if (c === "`") bt++;
  }
  if (sq % 2 === 1 || dq % 2 === 1 || bt % 2 === 1) return true;
  if (kind !== undefined && !COMMENT_DIRECTIVE.test(kind) &&
      /\/\/|\/\*|(^|\s)#(?!\[)|^\s*\*/.test(line.slice(0, idx))) return true;
  // a line that BEGINS with a bare regex literal (continuation of `X =` on
  // the previous line) — not // or /* comments
  const t = line.trimStart();
  if (t[0] === "/" && t[1] !== "/" && t[1] !== "*") return true;
  // regex-literal context: an unclosed /… opened after = ( , : [ or return
  return /(?:[=(,:[]|\breturn)\s*\/(?:[^/\\\n]|\\.)*$/.test(line.slice(0, idx));
}

// Language-bound idioms only count in their own languages: @Disabled in a
// .mjs file is prose ABOUT Java, not a disabled test. The original
// calibrated set (JS/py families) stays ungated — those idioms are the
// lineage the fleet numbers were built on.
export function kindAllowedInFile(kind, file) {
  const ext = ((file || "").match(/\.([a-z0-9_]+)$/i) || [, ""])[1].toLowerCase();
  const k = kind.trim();
  if (k === "@Disabled" || k === "@Ignore") return ["java", "kt", "kts", "scala", "groovy"].includes(ext);
  if (k.startsWith("[Ignore") || /^Skip\s*=\s*"?$/.test(k)) return ["cs", "fs", "vb"].includes(ext);
  if (k === "#[ignore") return ext === "rs";
  if (k.startsWith("markTest")) return ["php", "phtml"].includes(ext);
  if (k === "t.Skip(") return ext === "go";
  return true;
}

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
  if (r.status !== 0) {
    const err = new Error(r.stderr.trim() || `git ${args[0]} failed`);
    err.status = r.status; // callers distinguish "no matches" (1) from real failures
    throw err;
  }
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
    // Read one extra commit so an exact-size history is not falsely reported
    // as capped. Range scans are incremental and intentionally unbounded.
    "log", ...(opts.range ? [opts.range] : [`-${opts.max + 1}`]), "--no-merges", "--date=short", ...eraArgs(opts),
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
    const files = [];
    let adds = 0, dels = 0;
    for (const line of body.split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      const cls = classifyFile(m[3]);
      shape[cls] = (shape[cls] || 0) + 1;
      // events.jsonl is the query layer, not a display sample. Keep every path
      // (including docs/config/generated files) so --file is complete for the
      // analyzed commit window. Digest renderers still choose compact subsets.
      files.push(m[3]);
      if (m[1] !== "-") adds += Number(m[1]);
      if (m[2] !== "-") dels += Number(m[2]);
    }
    events.push({
      sha, fullSha, date, author,
      subject: subject.slice(0, 110),
      shape, files, adds, dels,
      revert: REVERT_PAT.test(subject),
      fix: FIX_PAT.test(subject),
      suppressions: [], del_asserts: 0, add_asserts: 0, downgrades: 0,
      // stamped at birth so every consumer (CLI, MCP, library callers) emits
      // one schema regardless of cache state; kept last to match disk order
      xv: EXTRACTOR_VERSION,
    });
  }
  const capped = !opts.range && events.length > opts.max;
  if (capped) events.length = opts.max;
  Object.defineProperty(events, "capped", { value: capped, enumerable: false });
  return events;
}

// ---------- layer 2: diff scan (suppressions + assertion deltas), one git pass ----------
export function diffScan(repo, events, opts, onProgress) {
  const bySha = new Map(events.map((e) => [e.fullSha, e]));
  // The -p pass is the expensive phase. Run it in commit WINDOWS so memory is
  // bounded and long builds can report progress (MCP clients reset their
  // timeout on progress notifications).
  // validate: a non-numeric, zero, or negative window would loop forever
  const winEnv = Math.floor(Number(process.env.LOGBOOK_WINDOW));
  const WINDOW = winEnv >= 1 ? winEnv : 4000;
  const total = events.length;
  let scanned = 0;
  const windows = [];
  if (opts.range) {
    windows.push(["log", opts.range, "--no-merges", "--pretty=%x1e%H", "-p", "--unified=0"]);
  } else {
    for (let skip = 0; skip < total; skip += WINDOW) {
      windows.push(["log", `-${Math.min(WINDOW, total - skip)}`, `--skip=${skip}`, "--no-merges",
        ...eraArgs(opts), "--pretty=%x1e%H", "-p", "--unified=0"]);
    }
  }
  for (const args of windows) {
    let patch;
    try {
      patch = git(repo, args);
    } catch {
      return false; // degrade to subject-level only
    }
    scanned = scanWindow(patch, bySha, scanned);
    if (onProgress) onProgress(Math.min(scanned, total), total);
  }
  return true;
}

function scanWindow(patch, bySha, scanned) {
  for (const chunk of patch.split("\x1e")) {
    if (!chunk.trim()) continue;
    const nl = chunk.indexOf("\n");
    const ev = bySha.get(chunk.slice(0, nl === -1 ? undefined : nl).trim());
    if (!ev) continue;
    const supp = new Set();
    // Track which file each hunk belongs to: asserts/suppressions in doc
    // examples or generated/vendored files are not evaluator changes.
    let counted = true;
    let curFile = "";
    let strongRemoved = 0, weakAdded = 0;
    const flushDowngrades = () => {
      ev.downgrades += Math.min(strongRemoved, weakAdded);
      strongRemoved = 0; weakAdded = 0;
    };
    for (const line of (nl === -1 ? "" : chunk.slice(nl + 1)).split("\n")) {
      if (line.startsWith("+++ ") || line.startsWith("--- ")) {
        if (line.startsWith("--- ")) flushDowngrades();
        const f = line.slice(4).replace(/^[ab]\//, "");
        if (f !== "/dev/null") {
          const cls = classifyFile(f);
          counted = cls !== "doc" && cls !== "gen";
          if (line.startsWith("+++ ")) curFile = f;
        }
        continue;
      }
      if (!counted) continue;
      // strip the diff +/- marker before matching: isMention's line-shape
      // checks (bare regex literal at line start) never fire on a prefixed line
      if (line.startsWith("+") && !line.startsWith("+++")) {
        const body = line.slice(1);
        for (const m of body.matchAll(SUPPRESS_PAT)) {
          if (!isMention(body, m.index, m[0]) && kindAllowedInFile(m[0], curFile)) supp.add(m[0].trim());
        }
        if (ASSERT_PAT.test(body)) ev.add_asserts++;
        if (WEAK_ASSERT_PAT.test(body)) weakAdded++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        const body = line.slice(1);
        if (ASSERT_PAT.test(body)) ev.del_asserts++;
        if (STRONG_ASSERT_PAT.test(body)) strongRemoved++;
      }
    }
    flushDowngrades();
    ev.suppressions = [...supp].sort().slice(0, 6);
    scanned++;
  }
  return scanned;
}

// ---------- ledger cache: reuse events.jsonl when fresh; append when stale ----------
export function loadEvents(repo, opts, onProgress) {
  if (process.env.LOGBOOK_NO_CACHE) return null;
  if (opts.max !== DEFAULT_MAX || opts.since || opts.until || opts.range) return null;
  let lines;
  try {
    lines = readFileSync(join(repo, "events.jsonl"), "utf8").split("\n").filter(Boolean);
  } catch { return null; }
  if (!lines.length) return null;
  let cached;
  try { cached = lines.map((l) => JSON.parse(l)); } catch { return null; }
  // self-heal: earlier incremental appends could duplicate window-boundary
  // commits (a log-order window is not ancestry-closed, so `newest..HEAD`
  // can re-return side-branch commits already cached); keep first occurrence
  const seenSha = new Set();
  cached = cached.filter((e) => !e.fullSha || (!seenSha.has(e.fullSha) && (seenSha.add(e.fullSha), true)));
  const newest = cached[0];
  if (!newest?.fullSha || newest.files === undefined || newest.downgrades === undefined) return null;
  if (newest.xv !== EXTRACTOR_VERSION) return null; // stale extractor: full rebuild
  // compare against the newest NON-merge commit — the ledger records
  // --no-merges, so a merge commit at HEAD would otherwise force a pointless
  // incremental pass (and, pre-dedupe, compounding duplicates) on every load
  let head;
  try { head = git(repo, ["log", "-1", "--no-merges", "--pretty=%H"]).trim(); } catch { return null; }
  // POSITION IS NOT TRUSTWORTHY: same-second commits (squash trains, agent
  // bursts) make git log's traversal order deviate from newest-first, so the
  // freshness and completeness checks test MEMBERSHIP, never array position.
  // completeness: a record written with a smaller -n window must not
  // masquerade as the full ledger — accept only cache-at-cap, or a cache
  // that contains a root commit of the repo (i.e. reaches the beginning).
  let reachesEveryRoot;
  try {
    // Merged unrelated histories have MULTIPLE roots. Besides validating a
    // short cache, root membership distinguishes exactly-at-max from capped.
    const roots = git(repo, ["rev-list", "--max-parents=0", "HEAD"]).split("\n").filter(Boolean);
    reachesEveryRoot = roots.every((r) => seenSha.has(r));
  } catch { return null; }
  if (cached.length < opts.max && !reachesEveryRoot) return null;
  // fresh if the ledger already contains the newest non-merge commit —
  // anything above it in the log is merges, which the ledger excludes
  if (seenSha.has(head))
    return { events: cached, mode: "cached", capped: cached.length >= opts.max && !reachesEveryRoot };
  // stale: try incremental append of only the new commits
  try {
    const fresh = collectEvents(repo, { ...opts, range: `${newest.fullSha}..HEAD` });
    if (!fresh.length) return null;
    diffScan(repo, fresh, { ...opts, range: `${newest.fullSha}..HEAD` }, onProgress);
    // the range can re-return cached side-branch commits (see self-heal note)
    const freshShas = new Set(fresh.map((e) => e.fullSha));
    const merged = fresh.concat(cached.filter((e) => !freshShas.has(e.fullSha))).slice(0, opts.max);
    const mergedShas = new Set(merged.map((e) => e.fullSha));
    const roots = git(repo, ["rev-list", "--max-parents=0", "HEAD"]).split("\n").filter(Boolean);
    const complete = roots.every((r) => mergedShas.has(r));
    return { events: merged, mode: `incremental +${fresh.length}`, capped: merged.length >= opts.max && !complete };
  } catch { return null; } // rewritten history etc: full rebuild
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
  // Era detection: a lone wrong-but-plausible date (one 2001 commit in a 2022
  // repo) poisons winter/span past the epoch floor. Skip isolated leading
  // dates that sit >3 years before the next, up to max(1, 0.5%) of commits.
  const times = oldest.filter((e) => validDate(e.date)).map((e) => Date.parse(e.date)).sort((a, b) => a - b);
  let sk = 0;
  const maxSkip = Math.max(1, Math.floor(times.length * 0.005));
  while (sk < maxSkip && sk + 1 < times.length && times[sk + 1] - times[sk] > 3 * 365.25 * 86400000) sk++;
  const eraStart = times.length ? times[sk] : 0;
  const inEra = (d) => { const t = Date.parse(d); return t >= eraStart && validDate(d); };
  let winter = { days: 0, from: null, to: null };
  for (let i = 1; i < oldest.length; i++) {
    if (!inEra(oldest[i].date) || !inEra(oldest[i - 1].date)) continue;
    const gap = Math.round(
      (new Date(oldest[i].date) - new Date(oldest[i - 1].date)) / 86400000
    );
    if (gap > winter.days) winter = { days: gap, from: oldest[i - 1].date, to: oldest[i].date };
  }
  const trials = fragile.slice(0, 3);

  const spanDays = times.length
    ? Math.max(1, Math.round((times[times.length - 1] - eraStart) / 86400000))
    : 0;

  // Notable events: outliers worth seeing even in the digest —
  // security-adjacent reverts, large assertion drops, suppression-dense commits.
  // Severity-ranked, not recency-sliced: a security-revert must never be pushed
  // out of the digest by recent routine churn.
  const isSecRevert = (e) => e.revert && /security|CVE-|vulnerab|exploit/i.test(e.subject);
  // Mass deletions (docs archival, module removal) lose thousands of asserts
  // legitimately — they are not evaluator weakening; exclude them here.
  const isMassDeletion = (e) => e.dels > 4 * Math.max(e.adds, 1) && e.dels > 150;
  const notablePool = events.filter((e) =>
    isSecRevert(e) ||
    (e.del_asserts - e.add_asserts >= 8 && !isMassDeletion(e)) ||
    (e.downgrades >= 2) ||
    (e.suppressions.length >= 3)
  );
  notablePool.sort((a, b) =>
    (isSecRevert(b) - isSecRevert(a)) ||
    ((b.del_asserts - b.add_asserts) - (a.del_asserts - a.add_asserts)) ||
    (b.suppressions.length - a.suppressions.length)
  );
  const notable = notablePool.slice(0, 8);
  const notableMore = notablePool.length - notable.length;

  // Per-file history: for the files an agent is most likely to touch (top
  // src hotspots), the reverts/suppressions/weakening that touched THEM.
  const perFile = touched
    .filter(([f]) => classifyFile(f) === "src").slice(0, 3)
    .map(([f]) => {
      const hits = oldest.filter((e) => e.files?.includes(f) &&
        (e.revert || e.suppressions.length > 0 || e.del_asserts - e.add_asserts > 2));
      hits.sort((a, b) => (b.revert - a.revert) ||
        ((b.del_asserts - b.add_asserts) - (a.del_asserts - a.add_asserts)));
      return { file: f, hits: hits.slice(0, 4), more: Math.max(0, hits.length - 4) };
    })
    .filter((x) => x.hits.length);

  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  return {
    notable, notableMore, perFile,
    n: events.length, first, last, spanDays,
    spanStart: times.length ? iso(eraStart) : first?.date,
    spanEnd: times.length ? iso(times[times.length - 1]) : last?.date,
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
  return `${days} day${days === 1 ? "" : "s"}`;
}
const fmt = (x) => x.toLocaleString("en-US");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Honest first-run expectation: a young or linear history has little
// recoverable decision memory, and the digest should SAY so instead of
// letting "memory" overclaim a hotspot map.
export function signalGrade(A) {
  const reverts = A.reverts.length, fragile = A.fragile.length,
    supp = A.suspEvents.length, weak = A.weaken.length;
  const parts = `${reverts} revert${reverts === 1 ? "" : "s"} · ${fragile} repeated-fix area${fragile === 1 ? "" : "s"} · ${supp} suppression event${supp === 1 ? "" : "s"} · ${weak} weakening event${weak === 1 ? "" : "s"}`;
  if (reverts === 0 && fragile === 0 && supp <= 1 && weak <= 1)
    return { level: "LOW", parts, note: "little recoverable decision history — the digest is mostly a hotspot map" };
  // the note names what actually fired, so a suppression-driven HIGH does
  // not send readers to an empty do-not-retry list
  const rich = [];
  if (reverts >= 3) rich.push("check do-not-retry before any large change");
  if (fragile >= 3) rich.push("mind the repeated-fix areas");
  if (supp >= 10) rich.push("run `logbook audit` — the suppression history is heavy");
  if (weak >= 10) rich.push("treat green tests with suspicion (see assertion-weakening)");
  if (rich.length)
    return { level: "HIGH", parts, note: `rich history: ${rich.join("; ")}` };
  return { level: "MEDIUM", parts, note: "some decision history worth checking before refactors" };
}

export function renderLogbookMd(name, A, shallow, capped, notes = []) {
  const usedNotes = new Set();
  const why = (e) => {
    const a = noteFor(notes, e);
    if (!a) return [];
    usedNotes.add(a.sha);
    return [`  - why (inferred by ${a.by}, ${a.date}): ${a.why}`];
  };
  const L = [];
  L.push(`# The Logbook of ${name}`);
  {
    const g = signalGrade(A);
    L.push(``, `_Historical signal: **${g.level}** (${g.parts}) — ${g.note}._`);
  }
  L.push(``);
  L.push(`_${fmt(A.n)} commit${A.n === 1 ? "" : "s"} (${A.spanStart} → ${A.spanEnd}), ${fmt(A.filesTouched)} file${A.filesTouched === 1 ? "" : "s"} touched, ${plural(A.authors, "author")}._`);
  if (shallow) L.push(`\n> ⚠️ Shallow clone — history is truncated. Run \`git fetch --unshallow\` for the full record.`);
  if (capped) L.push(`\n> ⚠️ Analysis capped at ${fmt(A.n)} commits (the repo has more). Re-run with \`-n <bigger>\` for the full record.`);
  if (A.degraded) L.push(`\n> ⚠️ Diff-level scan FAILED (git log -p errored) — suppression and assertion columns are unmeasured, not clean. Subject-level signals only.`);
  L.push(``);
  L.push(`## What a fresh session should know`);
  if (A.srcHot.length)
    L.push(`- The action lives in: ${A.srcHot.slice(0, 3).map(([f, c]) => `${f} (${c})`).join(", ")}`);
  L.push(`- Dominant author: ${A.topAuthor[0]} (${A.topAuthor[1]}/${A.n})`);
  if (A.reverts.length)
    L.push(`- ${A.reverts.length} reverted approaches — check the do-not-retry list before proposing big changes`);
  if (A.fragile.length)
    L.push(`- Fragile areas (fixed 2+ times): ${A.fragile.slice(0, 3).map(([k]) => k.trim()).join("; ")}`);
  L.push(`- Oversight ledger: ${plural(A.suspEvents.length, "suppression commit")}, ${plural(A.weaken.length, "assertion-weakening commit")}`);
  if (A.notable.length) {
    L.push(``);
    L.push(`## Notable events (outliers a reader should see)`);
    for (const e of A.notable) {
      const tags = [];
      if (e.revert && /security|CVE-|vulnerab|exploit/i.test(e.subject)) tags.push("security-revert");
      if (e.del_asserts - e.add_asserts >= 8) tags.push(`-${e.del_asserts} asserts`);
      if (e.downgrades >= 2) tags.push(`${e.downgrades} assert downgrades`);
      if (e.suppressions.length >= 3) tags.push(`${e.suppressions.length} suppressions`);
      L.push(`- ${e.date} ${e.sha} [${tags.join(", ")}] ${e.subject}`);
    }
    if (A.notableMore > 0) L.push(`- …and ${A.notableMore} more — full record in events.jsonl`);
  }
  if (A.perFile.length) {
    L.push(``);
    L.push(`## History by hotspot file (what touched the files you'll touch)`);
    for (const pf of A.perFile) {
      L.push(`### ${pf.file}`);
      for (const e of pf.hits) {
        const tag = e.revert ? "revert" :
          e.downgrades >= 2 ? `${e.downgrades} assert downgrades` :
          e.suppressions.length ? e.suppressions.slice(0, 2).join(" + ") :
          `-${e.del_asserts} asserts`;
        L.push(`- ${e.date} ${e.sha} [${tag}] ${e.subject}`, ...why(e));
      }
      if (pf.more) L.push(`- …and ${pf.more} more — full record in events.jsonl`);
    }
  }
  L.push(``);
  L.push(`## Hotspots — most frequently changed source files`);
  for (const [f, c] of A.srcHot) L.push(`- ${f} — ${plural(c, "commit")}`);
  L.push(``);
  L.push(`## Hotspots — all files (incl. config/docs churn)`);
  for (const [f, c] of A.allHot) L.push(`- ${f} — ${plural(c, "commit")}`);
  L.push(``);
  L.push(`## Do-not-retry: reverts / rollbacks (${A.reverts.length})`);
  if (notes.length)
    L.push(`_"why" lines are agent-inferred judgments persisted via \`logbook annotate\` — dated, attributed, and worth re-verifying: the fact never changes, but its force can age._`);
  // truncate the OLD end — the recent reverts are the ones a session must see
  if (A.reverts.length > 20) L.push(`- …${A.reverts.length - 20} earlier — full record in events.jsonl`);
  for (const e of A.reverts.slice(-20)) L.push(`- ${e.date} ${e.sha} ${e.subject}`, ...why(e));
  L.push(``);
  L.push(`## Suppression ledger (${plural(A.suspEvents.length, "commit")})`);
  if (A.suspEvents.length > 20) L.push(`- …${A.suspEvents.length - 20} earlier — full record in events.jsonl`);
  for (const e of A.suspEvents.slice(-20))
    L.push(`- ${e.date} ${e.sha} [${e.suppressions.slice(0, 3).join(" + ")}] ${e.subject}`, ...why(e));
  L.push(``);
  L.push(`## Assertion-weakening events (${A.weaken.length})`);
  for (const e of A.weaken.slice(0, 15)) {
    const tag =
      e.dels > 4 * Math.max(e.adds, 1) && e.dels > 150
        ? " [large removal — likely feature/module deletion]" : "";
    L.push(`- ${e.date} ${e.sha} (-${e.del_asserts}/+${e.add_asserts})${tag} ${e.subject}`);
  }
  if (A.weaken.length > 15) L.push(`- …and ${A.weaken.length - 15} more — full record in events.jsonl`);
  L.push(``);
  L.push(`## Fragile areas (same fix subject 2+ times)`);
  for (const [k, c] of A.fragile) L.push(`- ×${c}: ${k.trim()}`);
  L.push(``);
  // an annotated commit is by definition important — any why whose event fell
  // outside every section above still renders, never silently truncated
  const leftover = notes.filter((a) => !usedNotes.has(a.sha));
  if (leftover.length) {
    L.push(`## Annotated commits (whys persisted via \`logbook annotate\`)`);
    for (const a of leftover)
      L.push(`- ${a.sha.slice(0, 8)} — why (inferred by ${a.by}, ${a.date}): ${a.why}`);
    L.push(``);
  }
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
    B.push(["IX", "The Road Goes On", `${A.last.date} — "${A.last.subject.slice(0, 64)}". ${fmt(A.n)} commit${A.n === 1 ? "" : "s"} and counting.`, "good"]);
  return B;
}

// Fleet percentile tables — top 2,500 GitHub repos, 2026-07 (n=2500, 20k windows, extractor v4 mention-clean).
// reverts/bargains are per 1,000 commits (size-fair); winter in days.
// Regenerate from a fleet run per release; no network calls, ever.
export const FLEET = {
  reverts_per_1k: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.22,0.81,1.09,1.34,1.53,1.7,1.84,1.98,2.15,2.34,2.48,2.64,2.79,2.91,3.08,3.22,3.34,3.56,3.68,3.86,3.99,4.13,4.26,4.35,4.47,4.66,4.75,4.83,4.95,5.06,5.21,5.35,5.5,5.66,5.75,5.89,6.07,6.16,6.29,6.39,6.51,6.65,6.76,6.94,7.07,7.23,7.38,7.54,7.7,7.87,8.11,8.29,8.43,8.67,8.87,9.07,9.3,9.53,9.78,10,10.22,10.57,10.81,11.13,11.43,12,12.43,12.92,13.33,13.92,14.52,15.36,16.04,17.05,18.49,20.46,24.27,57.37],
  bargains_per_1k: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.21,0.36,0.5,0.66,0.86,1.09,1.27,1.47,1.71,1.95,2.2,2.5,2.76,3.06,3.57,3.86,4.44,4.78,5.06,5.41,6.02,6.43,6.99,7.61,7.97,8.43,9.02,9.65,10.18,10.99,11.66,12.27,13.14,13.93,14.98,15.79,16.75,17.7,18.54,19.52,20.88,22.15,23.88,25.64,27.2,30.2,33.29,36.28,40.62,44.8,48.93,52.92,58.82,70.17,85.07,108.19,1000],
  winter_days: [0,3,6,10,12,15,18,21,23,27,30,33,36,40,43,46,49,53,57,60,63,67,70,74,79,83,86,93,97,100,105,110,115,119,124,130,140,146,150,156,163,168,175,181,189,194,202,211,216,222,231,237,245,253,262,271,281,297,308,322,331,343,352,368,378,389,400,412,428,442,459,474,490,503,521,533,553,576,591,618,652,676,713,743,767,789,818,857,901,943,998,1060,1112,1194,1272,1381,1586,1810,2136,2552,4321],
};

export function fleetPct(key, val) {
  const a = FLEET[key];
  if (!a || !a.length) return null;
  let c = 0;
  for (const v of a) if (v < val) c++;
  return Math.round((100 * c) / a.length);
}

export function almanacPcts(A) {
  return {
    reverts: fleetPct("reverts_per_1k", (A.reverts.length / Math.max(A.n, 1)) * 1000),
    bargains: fleetPct("bargains_per_1k", (A.suspEvents.length / Math.max(A.n, 1)) * 1000),
    winter: A.winter.days ? fleetPct("winter_days", A.winter.days) : null,
  };
}

export function almanacStats(A) {
  const s = [["commits", fmt(A.n)], ["reverts", A.reverts.length], ["bargains", A.suspEvents.length]];
  if (A.abyss && A.abyss.dels > 100) s.push(["abyss", `−${fmt(A.abyss.dels)}`]);
  if (A.winter.days >= 14) s.push(["winter", `${A.winter.days}d`]);
  return s;
}

export function renderJourneyMd(name, A, compare) {
  const L = [`# ⚔️ The Journey of ${name}`, ``, `_An epic in ${fmt(A.n)} commit${A.n === 1 ? "" : "s"}, as entered in the logbook._`, ``];
  for (const [num, title, body] of journeyBeats(name, A)) L.push(`**${num}. ${title}.** ${body}`, ``);
  L.push(`---`);
  const pcts = compare ? almanacPcts(A) : {};
  L.push(`_The Logbook Almanac_ — ` + almanacStats(A).map(([k, v]) =>
    `${k} ${v}${pcts[k] != null ? ` (p${pcts[k]})` : ""}`).join(" · "));
  if (compare) L.push(`_Percentiles vs the top 2,500 repos on GitHub (size-fair, per 1k commits)._`);
  return L.join("\n") + "\n";
}

const C = process.stdout.isTTY || process.env.FORCE_COLOR
  ? { gold: "\x1b[38;5;220m", dim: "\x1b[38;5;245m", good: "\x1b[38;5;114m", info: "\x1b[38;5;44m", bad: "\x1b[38;5;203m", odd: "\x1b[38;5;177m", bold: "\x1b[1m", r: "\x1b[0m" }
  : { gold: "", dim: "", good: "", info: "", bad: "", odd: "", bold: "", r: "" };

export function renderJourneyAnsi(name, A, compare) {
  const L = [];
  L.push(`\n  ${C.gold}${C.bold}⚔  The Journey of ${name}${C.r}`);
  L.push(`  ${C.dim}an epic in ${fmt(A.n)} commit${A.n === 1 ? "" : "s"}, as entered in the logbook${C.r}`);
  for (const [num, title, body, tone] of journeyBeats(name, A))
    L.push(`\n  ${C[tone]}${C.bold}${num}. ${title}${C.r}\n  ${C.dim}${body}${C.r}`);
  const stats = almanacStats(A);
  const pcts = compare ? almanacPcts(A) : {};
  const sfx = (k) => (pcts[k] != null ? ` p${pcts[k]}` : "");
  const line = stats.map(([k, v]) => `${C.gold}${v}${C.r} ${C.dim}${k}${sfx(k)}${C.r}`).join(" · ");
  const plain = stats.map(([k, v]) => `${v} ${k}${sfx(k)}`).join(" · ");
  const w = Math.max(plain.length + 4, 42);
  L.push(`\n  ${C.gold}╭${"─".repeat(w)}╮${C.r}`);
  const title = "THE LOGBOOK ALMANAC";
  L.push(`  ${C.gold}│${C.r}  ${C.bold}${title}${C.r}${" ".repeat(w - title.length - 2)}${C.gold}│${C.r}`);
  L.push(`  ${C.gold}│${C.r}  ${line}${" ".repeat(w - plain.length - 2)}${C.gold}│${C.r}`);
  L.push(`  ${C.gold}╰${"─".repeat(w)}╯${C.r}`);
  if (compare) L.push(`  ${C.dim}percentiles vs the top 2,500 repos on GitHub${C.r}\n`);
  else L.push("");
  return L.join("\n");
}

// ---------- audit: what is STILL suppressed today, and since when ----------
export function auditHead(repo, events) {
  const live = [];
  let grep = "";
  try {
    // one C-speed pass over the whole tree; PCRE shares the JS pattern source
    grep = git(repo, ["grep", "-nP", SUPPRESS_PAT.source, "HEAD"]);
  } catch (e) {
    // exit 1 = no matches: genuinely clean. Anything else (git without PCRE
    // support, corrupt repo) must SURFACE — "unmeasurable" is not "clean".
    if (e?.status !== 1) throw new Error(`audit: git grep failed — ${String(e?.message).split("\n")[0]}`);
  }
  for (const row of grep.split("\n")) {
    if (!row) continue;
    const m = /^HEAD:([^:]+):(\d+):(.*)$/.exec(row);
    if (!m) continue;
    const [, file, lineNo, content] = m;
    const cls = classifyFile(file);
    if (cls === "doc" || cls === "gen") continue;
    // example/demo corpora are exhibits, not debt — the audit is a to-do list
    if (/(^|\/)(examples?|example_scripts|samples?|demos?)(\/|$)/i.test(file)) continue;
    // vendored copies and test-framework sources DEFINE the skip API
    // (jasmine's xit/xdescribe, mocha's describe.skip) — not debt either
    if (/(^|\/)(third[-_]?party|externals?)(\/|$)/i.test(file)) continue;
    if (/(^|\/)(jasmine|mocha|chai|qunit|sinon)([-.][\w.]+)?\.js$/i.test(file)) continue;
    for (const hit of content.matchAll(SUPPRESS_PAT)) {
      if (isMention(content, hit.index, hit[0])) continue;
      if (!kindAllowedInFile(hit[0], file)) continue;
      live.push({ file, line: Number(lineNo), kind: hit[0].trim() });
    }
  }
  // join: heuristic-date everything from the ledger (cheap, approximate),
  // sort, then blame-refine the entries that will actually be displayed —
  // git blame gives the EXACT commit for each live line, at a bounded cost
  // regardless of how suppression-heavy the repo is. (Previously repos with
  // >120 findings skipped blame entirely and every entry inherited the
  // file's EARLIEST skip date — pytest showed 2010 for a line from 2025.)
  const oldest = [...events].reverse();
  const heuristic = (item) => {
    let hit = oldest.find((e) => e.files?.includes(item.file) &&
      e.suppressions.some((s) => s === item.kind));
    if (!hit) hit = oldest.find((e) => e.files?.includes(item.file) && e.suppressions.length);
    item.since = hit ? hit.date : null;
    item.sha = hit ? hit.sha : null;
  };
  const blame = (item) => {
    try {
      const b = git(repo, ["blame", "-L", `${item.line},${item.line}`, "--porcelain", "HEAD", "--", item.file]);
      const sha = b.slice(0, 8);
      const t = /author-time (\d+)/.exec(b);
      const tz = /author-tz ([+-]\d{4})/.exec(b);
      if (t) {
        const off = tz ? (Number(tz[1].slice(0, 3)) * 60 + Number(tz[1][0] + tz[1].slice(3))) * 60000 : 0;
        item.since = new Date(Number(t[1]) * 1000 + off).toISOString().slice(0, 10);
        item.sha = sha;
        return true;
      }
    } catch { /* fall through to heuristic date already set */ }
    return false;
  };
  for (const item of live) heuristic(item);
  const byDate = (a, b) => ((a.since || "9999") < (b.since || "9999") ? -1 : 1);
  live.sort(byDate);
  // displayed entries get two precision passes, each bounded: (1) drop
  // matches sitting inside a multi-line string (pytest embeds whole test
  // files with skip markers in triple-quoted fixtures — mentions, not
  // directives; line-local isMention can't see that context, but here the
  // full file is available), then (2) blame the survivors for exact dates.
  const fileCache = new Map();
  const inMultilineString = (item) => {
    const py = /\.pyi?$/.test(item.file), tick = /\.(m?[jt]sx?|go)$/.test(item.file);
    if (!py && !tick) return false;
    let text = fileCache.get(item.file);
    if (text === undefined) {
      try { text = git(repo, ["show", `HEAD:${item.file}`]); } catch { text = null; }
      fileCache.set(item.file, text);
    }
    if (text == null) return false;
    const lines = text.split("\n").slice(0, item.line - 1);
    let triple = false, tickOpen = false;
    for (const ln of lines) {
      if (py) { const n = (ln.match(/'''|"""/g) || []).length; if (n % 2) triple = !triple; }
      if (tick) {
        let esc = false;
        for (const c of ln) {
          if (esc) { esc = false; continue; }
          if (c === "\\") esc = true;
          else if (c === "`") tickOpen = !tickOpen;
        }
      }
    }
    return triple || tickOpen;
  };
  // PHPUnit's markTestSkipped/-Incomplete is almost always a conditional
  // environment guard (`if (!extension_loaded(...))`) — gating, not debt.
  // The annotation forms (@Disabled, [Ignore], Skip=, #[ignore]) are
  // unconditional by construction and need no such check.
  const isGuarded = (item) => {
    if (!item.kind.startsWith("markTest")) return false;
    let text = fileCache.get(item.file);
    if (text === undefined) {
      try { text = git(repo, ["show", `HEAD:${item.file}`]); } catch { text = null; }
      fileCache.set(item.file, text);
    }
    if (text == null) return false;
    const ctx = text.split("\n").slice(Math.max(0, item.line - 4), item.line).join("\n");
    return /\b(if|unless)\s*\(/.test(ctx);
  };
  const refined = [];
  for (const item of live) {
    if (refined.length >= 40) break;
    if (inMultilineString(item) || isGuarded(item)) { item.drop = true; continue; }
    blame(item);
    refined.push(item);
  }
  const kept = live.filter((x) => !x.drop);
  kept.sort(byDate);
  live.length = 0;
  live.push(...kept);
  // Fight log (pickaxe): for displayed findings, how many times was this
  // suppression removed and RE-added? One git log -S pass per item.
  {
    for (const item of live.slice(0, 30)) {
      try {
        const out = git(repo, ["log", "-S", item.kind, "--format=%x1e%H", "-p", "--unified=0", "--", item.file]);
        let seq = "";
        for (const chunk of out.split("\x1e")) {
          if (!chunk.trim()) continue;
          let adds = 0, dels = 0;
          for (const l of chunk.split("\n")) {
            if (l.startsWith("+") && !l.startsWith("+++") && l.includes(item.kind)) adds++;
            else if (l.startsWith("-") && !l.startsWith("---") && l.includes(item.kind)) dels++;
          }
          if (adds > dels) seq = "+" + seq;        // log is newest-first; build oldest-first
          else if (dels > adds) seq = "-" + seq;
        }
        let seenMinus = false, re = 0;
        for (const ch of seq) { if (ch === "-") seenMinus = true; else if (ch === "+" && seenMinus) re++; }
        if (re > 0) { item.fight = seq; item.resilenced = re; }
      } catch { /* untagged */ }
    }
  }
  return live;
}

function renderAudit(name, live) {
  const W = [];
  const now = Date.now();
  W.push(`\n  ${C.gold}${C.bold}⚓ Suppression audit of ${name}${C.r}`);
  W.push(`  ${C.dim}what is still silenced in HEAD, and since when${C.r}\n`);
  if (!live.length) {
    W.push(`  ${C.good}clean — no live suppressions in src/test/config files${C.r}\n`);
    return W.join("\n");
  }
  for (const x of live.slice(0, 30)) {
    const age = x.since ? `${((now - Date.parse(x.since)) / 31557600000).toFixed(1)}y` : "?";
    const since = x.since ? `since ${x.since} (${age})` : "origin outside window";
    const fight = x.resilenced ? `  ${C.gold}re-silenced ×${x.resilenced} (${x.fight})${C.r}` : "";
    W.push(`  ${C.bad}${x.kind}${C.r}  ${x.file}:${x.line}  ${C.dim}${since}${C.r}${fight}`);
  }
  if (live.length > 30) W.push(`  ${C.dim}…and ${live.length - 30} more${C.r}`);
  const dated = live.filter((x) => x.since);
  const oldest = dated[0];
  W.push(`\n  ${C.gold}${live.length} live suppression${live.length === 1 ? "" : "s"}${C.r}${oldest ? `${C.dim} · oldest ${((now - Date.parse(oldest.since)) / 31557600000).toFixed(1)} years (${oldest.file})${C.r}` : ""}\n`);
  return W.join("\n");
}

// ---------- query: first-class filters over the event record ----------
export function queryEvents(events, f) {
  return events.filter((e) =>
    (!f.file || (e.files || []).some((x) => x.includes(f.file))) &&
    (!f.revert || e.revert) &&
    (!f.suppress || e.suppressions.length > 0) &&
    (f.weaken == null || e.del_asserts - e.add_asserts >= f.weaken) &&
    (f.downgrade == null || (e.downgrades || 0) >= f.downgrade) &&
    (!f.since || e.date >= f.since) &&
    (!f.until || e.date <= f.until) &&
    (!f.grep || e.subject.toLowerCase().includes(f.grep.toLowerCase()))
  );
}

// ---------- annotations: persisted agent judgments, layered on the record ----------
// Lazy enrichment: when an agent investigates WHY a commit happened (a revert's
// failure mode, a suppression's cause), it persists the finding here instead of
// discarding it at session end. annotations.jsonl is append-only, keyed by full
// sha (immutable — never invalidates), last write per sha wins. Judgments, not
// records: rendered with provenance and an age stamp, never mixed into events.
export function loadAnnotations(dir) {
  const p = join(dir, "annotations.jsonl");
  if (!existsSync(p)) return [];
  const bySha = new Map();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const a = JSON.parse(line);
      if (a.sha && a.why) bySha.set(a.sha, a);
    } catch { /* skip malformed lines rather than fail the render */ }
  }
  return [...bySha.values()];
}

export function saveAnnotation(repo, dir, { sha, why, by }) {
  const r = spawnSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${sha}^{commit}`], { encoding: "utf8" });
  const full = (r.stdout || "").trim();
  if (r.status !== 0 || !full) return null;
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const a = { sha: full, why: String(why).slice(0, 400), by: by || "agent", date: local };
  // idempotent: an identical annotation (same sha+why+by) is a no-op, not
  // a duplicate line — repeated MCP retries must not grow the file
  const existing = loadAnnotations(dir).find((x) => x.sha === a.sha && x.why === a.why && x.by === a.by);
  if (existing) return existing;
  writeFileSync(join(dir, "annotations.jsonl"), JSON.stringify(a) + "\n", { flag: "a" });
  return a;
}

export function noteFor(notes, e) {
  if (!notes.length) return null;
  return notes.find((a) => (e.fullSha && a.sha === e.fullSha) || a.sha.startsWith(e.sha)) || null;
}

// ---------- CLI ----------
function usage() {
  console.log(`
  ${C.bold}logbook${C.r} — turn git history into memory an agent can use

  usage:
    logbook init [path]           analyze + wire AGENTS.md/CLAUDE.md/.cursorrules
                                  so your agent is instructed to read history first
    logbook [path]                analyze repo → LOGBOOK.md, events.jsonl, JOURNEY.md
    logbook journey [path]        the repo's story, in color (writes nothing)
    logbook audit [path]          what is STILL suppressed in HEAD, and since when
    logbook query [path] [--file S] [--revert] [--suppress] [--weaken N]
                  [--downgrade N] [--grep S] [--since D] [--until D] [--limit N]
                                  filter the full event record (JSONL out)
    logbook annotate SHA "WHY" [path] [--by WHO]
                                  persist WHY a commit happened (lazy enrichment:
                                  when your agent investigates a revert, keep it)
    logbook [path] --json         structured events to stdout (writes nothing)

  options:
    -n, --max N        commits to analyze (default ${DEFAULT_MAX})
    --compare          rank your almanac against the top 2,500 GitHub repos
    --since / --until  era-scoped archaeology (git date formats)
    --out DIR          write artifacts somewhere other than the repo root
    -q, --quiet        suppress the summary
    -v, --version      print version

  The logbook records; the referee (promptwheel) judges.
`);
}

export function parseArgs(argv) {
  const o = { cmd: "run", repo: ".", max: DEFAULT_MAX, since: null, until: null, json: false, quiet: false, out: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "journey") o.cmd = "journey";
    else if (a === "init") o.cmd = "init";
    else if (a === "audit") o.cmd = "audit";
    else if (a === "query") o.cmd = "query";
    else if (a === "annotate") o.cmd = "annotate";
    else if (a === "--by") o.by = argv[++i];
    else if (a === "--file") o.file = argv[++i];
    else if (a === "--revert") o.revert = true;
    else if (a === "--suppress") o.suppress = true;
    else if (a === "--weaken") o.weaken = Number(argv[++i]);
    else if (a === "--downgrade") o.downgrade = Number(argv[++i]);
    else if (a === "--grep") o.grep = argv[++i];
    else if (a === "--limit") o.limit = Number(argv[++i]);
    else if (a === "-n" || a === "--max") o.max = Number(argv[++i]);
    else if (a === "--since") o.since = argv[++i];
    else if (a === "--until") o.until = argv[++i];
    else if (a === "--json") o.json = true;
    else if (a === "-q" || a === "--quiet") o.quiet = true;
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--compare") o.compare = true;
    else if (a === "-h" || a === "--help") o.cmd = "help";
    else if (a === "-v" || a === "--version") o.cmd = "version";
    else if (!a.startsWith("-")) rest.push(a);
  }
  if (o.cmd === "annotate") {
    // annotate <sha> "<why>" [repo] — sha and why are positional
    o.sha = rest[0]; o.why = rest[1];
    if (rest[2]) o.repo = rest[2];
  } else if (rest.length) o.repo = rest[0];
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

  // resolve to the repo ROOT so running from a nested package dir works
  // (and artifacts land at the root, where agents look for them)
  let repo = resolve(o.repo);
  {
    const r = spawnSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) repo = r.stdout.trim();
    else if (!existsSync(join(repo, "HEAD"))) { // bare repos pass through
      console.error(`  not a git repository: ${repo}`);
      process.exit(1);
    }
  }
  const name = basename(repo);
  const shallow = existsSync(join(repo, ".git", "shallow"));

  if (o.cmd === "annotate") {
    if (!o.sha || !o.why) {
      console.error(`  usage: logbook annotate <sha> "<why it happened>" [repo] [--by <who>]`);
      process.exit(1);
    }
    const dir = o.out ? resolve(o.out) : repo;
    mkdirSync(dir, { recursive: true });
    const a = saveAnnotation(repo, dir, { sha: o.sha, why: o.why, by: o.by });
    if (!a) {
      console.error(`  not a commit in this repo: ${o.sha}`);
      process.exit(1);
    }
    // merge into LOGBOOK.md now if a complete ledger is on disk (sub-second
    // via reuse) — a session that finds fresh artifacts won't re-run the CLI,
    // so "next run" may never come
    let merged = false;
    if (existsSync(join(dir, "LOGBOOK.md"))) {
      const reused = loadEvents(repo, o);
      if (reused) {
        const A = analyze(reused.events, hotspots(repo, o));
        writeFileSync(join(dir, "LOGBOOK.md"),
          renderLogbookMd(name, A, shallow, reused.capped, loadAnnotations(dir)));
        merged = true;
      }
    }
    if (!o.quiet) {
      console.log(`  ${C.good}✓${C.r} annotated ${C.bold}${a.sha.slice(0, 8)}${C.r} ${C.dim}(by ${a.by}, ${a.date})${C.r}`);
      console.log(`  ${C.dim}${merged ? "merged into LOGBOOK.md" : "merged into LOGBOOK.md on the next run"}${C.r}\n`);
    }
    return;
  }

  if (!o.quiet && !o.json) console.error(`\n  ${C.dim}reading git history…${C.r}`);
  const reused = loadEvents(repo, o);
  let events, capped;
  if (reused) {
    events = reused.events;
    capped = reused.capped;
    if (!o.quiet && !o.json) console.error(`  ${C.dim}(ledger ${reused.mode})${C.r}`);
  } else {
    events = collectEvents(repo, o);
    capped = events.capped;
  }
  if (!events.length) {
    console.error("  no commits found (empty repo, or --since/--until excluded everything)");
    process.exit(1);
  }
  // one shape everywhere: cached events arrive stamped from disk, fresh ones
  // don't — normalize before --json, query, analysis, and the ledger write,
  // so the public JSON is identical regardless of cache state
  events = events.map((e) => ({ ...e, xv: EXTRACTOR_VERSION }));
  let scanOk = true;
  if (!reused) scanOk = diffScan(repo, events, o);
  const touched = hotspots(repo, o);
  const A = analyze(events, touched);
  if (!scanOk) {
    A.degraded = true;
    console.error("  ⚠ diff scan failed — suppression/assertion columns are unmeasured, not clean");
  }

  if (o.json) {
    if (!scanOk) {
      console.error("logbook: diff scan failed — the record would be incomplete, refusing to emit it as data");
      process.exit(1);
    }
    for (const e of events) console.log(JSON.stringify(e));
    return;
  }
  if (o.cmd === "journey") return console.log(renderJourneyAnsi(name, A, o.compare));
  if (o.cmd === "audit") return console.log(renderAudit(name, auditHead(repo, events)));
  if (o.cmd === "query") {
    if (!scanOk) {
      console.error("logbook: diff scan failed — the record would be incomplete, refusing to query it");
      process.exit(1);
    }
    const limit = o.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1) {
      console.error("logbook: --limit must be a positive integer");
      process.exit(1);
    }
    const all = queryEvents(events, o);
    const hits = all.slice(0, limit);
    for (const e of hits) console.log(JSON.stringify(e));
    const count = `${all.length} matching event${all.length === 1 ? "" : "s"}, returned ${hits.length}`;
    const truncated = all.length > hits.length
      ? " — TRUNCATED: narrow with --file/--revert or pass a higher --limit before concluding"
      : "";
    console.error(`  ${count}${truncated}`);
    if (capped)
      console.error(`  analysis capped at ${fmt(o.max)} commits — use -n for a larger window or --since/--until for another era`);
    return;
  }

  if (o.cmd === "init" && o.out) {
    console.error(`  init ignores --out: the wiring points agents at the repo root`);
    o.out = null;
  }
  const outDir = o.out ? resolve(o.out) : repo;
  mkdirSync(outDir, { recursive: true });
  const notes = loadAnnotations(outDir);
  writeFileSync(join(outDir, "LOGBOOK.md"), renderLogbookMd(name, A, shallow, capped, notes));
  // a failed scan must not persist: the next run would accept the partial
  // ledger as valid and the degraded warning would silently disappear
  if (scanOk) writeFileSync(join(outDir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(join(outDir, "JOURNEY.md"), renderJourneyMd(name, A, o.compare));

  if (o.cmd === "init") {
    const block = `\n## Repo memory\nBefore planning or editing:\n1. Read LOGBOOK.md at the repo root completely before any history query.\n2. If Historical signal is LOW, use it only as a hotspot map. Otherwise,\n   inspect task-relevant do-not-retry entries and fragile areas.\n3. For completeness, query relevant paths before broad terms:\n   npx -y @promptwheel/logbook query --file path/to/file --revert\n   If output says TRUNCATED, narrow filters or raise --limit before concluding.\n4. Treat findings as leads, not verdicts. Verify claims with git show SHA and\n   confirm that the constraint still applies to the current tree.\nRefresh the record: npx -y @promptwheel/logbook\nCheck what is still silenced: npx -y @promptwheel/logbook audit\nWhen you investigate WHY a listed commit happened and verify it in the\ndiffs, persist it (replace SHA, the sentence, and MODEL with your own\nmodel name; never annotate guesses):\nnpx -y @promptwheel/logbook annotate SHA "one specific sentence" --by MODEL\n`;
    // Migrate ONLY exact blocks generated by released versions. A user-edited
    // block is theirs, so the header alone is never permission to rewrite it.
    const oldBlocks = [
      `\n## Repo memory\nRead LOGBOOK.md (at the repo root) before proposing changes. If its\nHistorical signal is LOW, treat it as a hotspot map; otherwise check the\ndo-not-retry list and fragile areas before any large change. Refresh with:\nnpx -y @promptwheel/logbook\nCheck what is still silenced: npx -y @promptwheel/logbook audit\nWhen you investigate WHY a listed commit happened and verify it in the\ndiffs, persist it (replace SHA, the sentence, and MODEL with your own\nmodel name; never annotate guesses):\nnpx -y @promptwheel/logbook annotate SHA "one specific sentence" --by MODEL\n`,
      `\n## Repo memory\nRead LOGBOOK.md (at the repo root) before proposing changes. If its\nHistorical signal is LOW, treat it as a hotspot map; otherwise check the\ndo-not-retry list and fragile areas before any large change. Refresh with:\nnpx -y @promptwheel/logbook\nCheck what is still silenced: npx -y @promptwheel/logbook audit\nWhen you investigate WHY a listed commit happened and verify it in the\ndiffs, persist it (replace SHA and the sentence; never annotate guesses):\nnpx -y @promptwheel/logbook annotate SHA "one specific sentence" --by codex\n`,
      `\n## Repo memory\nRead LOGBOOK.md (at the repo root) before proposing changes — especially\nthe do-not-retry list and fragile areas. Refresh with:\nnpx -y @promptwheel/logbook\nCheck what is still silenced: npx -y @promptwheel/logbook audit\nWhen you investigate WHY a listed commit happened and verify it in the\ndiffs, persist it (replace SHA and the sentence; never annotate guesses):\nnpx -y @promptwheel/logbook annotate SHA "one specific sentence" --by codex\n`,
      `\n## Repo memory\nRead LOGBOOK.md before proposing changes — especially the do-not-retry\nlist and fragile areas. Refresh with: npx -y @promptwheel/logbook\nCheck what is still silenced: npx -y @promptwheel/logbook audit\nWhen you investigate WHY a listed commit happened, persist the finding:\nnpx -y @promptwheel/logbook annotate <sha> "<why>" --by <model>\n`,
    ];
    // AGENTS.md is the cross-tool convention — always ensure it exists;
    // also wire tool-specific files that are present. AGENTS.override.md
    // SHADOWS AGENTS.md in Codex, so it must be wired too when it exists.
    const targets = ["AGENTS.override.md", "CLAUDE.md", ".cursorrules"].filter((f) => existsSync(join(repo, f)));
    targets.unshift("AGENTS.md");
    for (const f of targets) {
      const p = join(repo, f);
      const cur = existsSync(p) ? readFileSync(p, "utf8") : "";
      // a CLAUDE.md that imports AGENTS.md is wired through the import —
      // appending the block would duplicate it in Claude's context
      if (f === "CLAUDE.md" && !cur.includes("## Repo memory") && /(^|\n)@AGENTS\.md\s*(\n|$)/.test(cur)) {
        if (!o.quiet) console.log(`  ${C.dim}=${C.r} ${f} already wired (imports AGENTS.md)`);
        continue;
      }
      if (cur.includes("## Repo memory")) {
        const old = oldBlocks.find((b) => cur.includes(b));
        if (old) {
          writeFileSync(p, cur.replace(old, block));
          if (!o.quiet) console.log(`  ${C.good}✓${C.r} updated ${C.bold}${f}${C.r}   ${C.dim}repo-memory workflow refreshed${C.r}`);
        } else if (!o.quiet) console.log(`  ${C.dim}=${C.r} ${f} already wired`);
      } else {
        writeFileSync(p, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + block);
        if (!o.quiet) console.log(`  ${C.good}✓${C.r} wired ${C.bold}${f}${C.r}   ${C.dim}agent instructed to read history first${C.r}`);
      }
    }
    // Claude Code reads CLAUDE.md, not AGENTS.md. A fresh repo gets the
    // documented bridge (an @AGENTS.md import) so the wiring actually loads:
    // https://docs.anthropic.com/en/docs/claude-code/memory
    const claudePath = join(repo, "CLAUDE.md");
    if (!existsSync(claudePath)) {
      writeFileSync(claudePath, "@AGENTS.md\n");
      if (!o.quiet) console.log(`  ${C.good}✓${C.r} wired ${C.bold}CLAUDE.md${C.r}   ${C.dim}bridges Claude Code to AGENTS.md${C.r}`);
    }
  }
  if (!o.quiet) {
    const g = signalGrade(A);
    console.log(`  ${fmt(A.n)} commit${A.n === 1 ? "" : "s"}${capped ? ` (capped — use -n for more)` : ""} · ${fmt(A.filesTouched)} file${A.filesTouched === 1 ? "" : "s"} · ${spanHuman(A.spanDays)} · ${plural(A.authors, "author")}`);
    console.log(`  historical signal: ${g.level === "LOW" ? C.dim : g.level === "HIGH" ? C.good : ""}${g.level}${C.r} ${C.dim}(${g.parts})${C.r}\n`);
    if (g.level === "LOW" && o.cmd === "init")
      console.log(`  ${C.dim}note: ${g.note} — the wiring stays useful, but expect hotspots, not war stories, until this repo has more history${C.r}\n`);
    console.log(`  ${C.good}✓${C.r} wrote ${C.bold}LOGBOOK.md${C.r}   ${C.dim}hotspots · do-not-retry · suppression ledger${notes.length ? ` · ${notes.length} why${notes.length === 1 ? "" : "s"}` : ""}${C.r}`);
    console.log(`  ${C.good}✓${C.r} wrote ${C.bold}events.jsonl${C.r}   ${C.dim}${fmt(A.n)} structured event${A.n === 1 ? "" : "s"}${C.r}`);
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
