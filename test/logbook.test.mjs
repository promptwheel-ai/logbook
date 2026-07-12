import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  SUPPRESS_PAT, classifyFile, parseArgs, collectEvents, diffScan, hotspots, analyze,
  renderLogbookMd, renderJourneyMd, journeyBeats, almanacStats,
  loadAnnotations, saveAnnotation, loadEvents, kindAllowedInFile, signalGrade,
  EXTRACTOR_VERSION,
} from "../bin/logbook.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "logbook.mjs");

// ---------- fixture repo: a scripted history containing every event type ----------
let repo;
function git(args, date) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "Hero", GIT_AUTHOR_EMAIL: "h@x.io",
    GIT_COMMITTER_NAME: "Hero", GIT_COMMITTER_EMAIL: "h@x.io" };
  if (date) { env.GIT_AUTHOR_DATE = `${date}T12:00:00`; env.GIT_COMMITTER_DATE = `${date}T12:00:00`; }
  return execFileSync("git", ["-C", repo, ...args], { env, encoding: "utf8" });
}
function commit(msg, date) { git(["add", "-A"]); git(["commit", "-q", "-m", msg], date); }

before(() => {
  repo = mkdtempSync(join(tmpdir(), "logbook-fixture-"));
  git(["init", "-q"]);
  // I. The Call
  writeFileSync(join(repo, "core.js"), "export const add = (a, b) => a + b;\n");
  commit("first light", "2024-01-01");
  // II. The Threshold — the repo accepts a gate
  mkdirSync(join(repo, "test"), { recursive: true });
  writeFileSync(join(repo, "test", "core.test.js"),
    "import assert from 'assert';\nassert.equal(add(1,1), 2);\nassert.equal(add(2,2), 4);\nassert.equal(add(0,0), 0);\nassert.equal(add(3,3), 6);\n");
  commit("add tests for core math", "2024-01-10");
  // fragile area: same fix twice
  writeFileSync(join(repo, "core.js"), "export const add = (a, b) => Number(a) + Number(b);\n");
  commit("fix overflow in currency rounding logic", "2024-02-01");
  writeFileSync(join(repo, "core.js"), "export const add = (a, b) => Number(a) + Number(b); // v2\n");
  commit("fix overflow in currency rounding logic again", "2024-02-05");
  // VII. Whispered Bargain — suppression added in the DIFF (subject says nothing)
  writeFileSync(join(repo, "core.js"),
    "/* eslint-disable no-unused-vars */\nexport const add = (a, b) => Number(a) + Number(b);\n");
  commit("tidy module header", "2024-03-01");
  // assertion weakening: remove 4 asserts, add 0
  writeFileSync(join(repo, "test", "core.test.js"), "// TODO: restore\n");
  commit("simplify test harness", "2024-03-10");
  // V. The Abyss — big deletion
  writeFileSync(join(repo, "legacy.js"), Array.from({ length: 300 }, (_, i) => `// line ${i}`).join("\n") + "\n");
  commit("import legacy module", "2024-04-01");
  rmSync(join(repo, "legacy.js"));
  commit("remove legacy module wholesale", "2024-04-15");
  // VIII. Paths Unwalked — a revert  … then VI. The Long Winter (90 days)
  writeFileSync(join(repo, "core.js"), "export const add = (a, b) => Number(a) + Number(b);\n");
  commit('Revert "tidy module header"', "2024-05-01");
  writeFileSync(join(repo, "epilogue.md"), "still here\n");
  commit("return from the long silence", "2024-08-01");
});

// ---------- unit: classifiers & args ----------
test("classifyFile buckets correctly", () => {
  assert.equal(classifyFile("src/index.ts"), "src");
  assert.equal(classifyFile("test/core.test.js"), "test");
  assert.equal(classifyFile("a/b.spec.tsx"), "test");
  assert.equal(classifyFile("package.json"), "config");
  assert.equal(classifyFile(".github/workflows/ci.yml"), "config");
  assert.equal(classifyFile("README.md"), "doc");
  assert.equal(classifyFile("dist/bundle.js"), "gen");
  assert.equal(classifyFile("package-lock.json"), "gen");
  assert.equal(classifyFile(".env.example"), "config");
  assert.equal(classifyFile(".gitignore"), "config");
  assert.equal(classifyFile("next.config.ts"), "config");
  assert.equal(classifyFile("next-env.d.ts"), "gen");
});

test("signal grade: boundaries and driver-matched notes", () => {
  const mk = (r, f, sp, w) => ({ reverts: Array(r), fragile: Array(f), suspEvents: Array(sp), weaken: Array(w) });
  assert.equal(signalGrade(mk(0, 0, 0, 0)).level, "LOW");
  assert.equal(signalGrade(mk(0, 0, 1, 1)).level, "LOW");
  assert.equal(signalGrade(mk(1, 0, 2, 0)).level, "MEDIUM");
  assert.equal(signalGrade(mk(3, 0, 0, 0)).level, "HIGH");
  assert.equal(signalGrade(mk(0, 0, 10, 0)).level, "HIGH");
  assert.equal(signalGrade(mk(0, 0, 0, 100)).level, "HIGH");
  assert.match(signalGrade(mk(0, 0, 10, 0)).note, /audit/, "suppression HIGH points at audit, not do-not-retry");
  assert.match(signalGrade(mk(3, 0, 0, 0)).note, /do-not-retry/);
  assert.match(signalGrade(mk(0, 0, 0, 100)).note, /green|weakening/i);
  assert.match(signalGrade(mk(0, 0, 0, 100)).parts, /100 weakening/);
});

test("signal grade: honest LOW on thin history, not LOW on the fixture", () => {
  const opts = { max: 5000, since: null, until: null };
  const events = collectEvents(repo, opts);
  diffScan(repo, events, opts);
  const A = analyze(events, hotspots(repo, opts));
  assert.notEqual(signalGrade(A).level, "LOW", "fixture has reverts+fragile areas");
  const thin = { reverts: [], fragile: [], suspEvents: [], weaken: [] };
  const g = signalGrade(thin);
  assert.equal(g.level, "LOW");
  assert.match(renderLogbookMd("x", { ...A, reverts: [], fragile: [], suspEvents: [], weaken: [] },
    false, false), /Historical signal: \*\*LOW\*\*/);
});

test("language-bound idioms only count in their own languages", () => {
  assert.ok(kindAllowedInFile("@Disabled", "src/FooTest.java"));
  assert.ok(kindAllowedInFile("t.Skip(", "pkg/x_test.go"));
  assert.ok(kindAllowedInFile("#[ignore", "src/lib.rs"));
  assert.ok(!kindAllowedInFile("@Disabled", "bin/logbook.mjs"), "Java idiom in JS = prose");
  assert.ok(!kindAllowedInFile("[Ignore", "bin/logbook.mjs"));
  assert.ok(!kindAllowedInFile("#[ignore", "notes.md"));
  assert.ok(!kindAllowedInFile("t.Skip(", "scan.py"));
  assert.ok(kindAllowedInFile("eslint-disable", "weird.xyz"), "original set stays ungated");
});

test("suppression idioms across languages match directives, not lookalikes", () => {
  const yes = ['@Disabled("flaky")', '@Ignore("ci")', '[Ignore("db")]',
    '[Fact(Skip = "unstable")]', '#[ignore]', '$this->markTestSkipped("x");',
    't.Skip("go")', '@pytest.mark.skip', '@unittest.skip'];
  const no = ['@pytest.mark.skipif(c, reason="r")', '@unittest.skipIf(c, "r")',
    'input.Skip(3)', '[IgnoreAntiforgeryToken]', 'skipWaiting()', 'disabled=true'];
  for (const s of yes) { SUPPRESS_PAT.lastIndex = 0; assert.ok(SUPPRESS_PAT.test(s), `matches: ${s}`); }
  for (const s of no) { SUPPRESS_PAT.lastIndex = 0; assert.ok(!SUPPRESS_PAT.test(s), `clean: ${s}`); }
});

test("parseArgs handles command, path, and flags", () => {
  const o = parseArgs(["journey", "/some/repo", "-n", "100", "--since", "2024-01-01", "-q"]);
  assert.equal(o.cmd, "journey");
  assert.equal(o.repo, "/some/repo");
  assert.equal(o.max, 100);
  assert.equal(o.since, "2024-01-01");
  assert.equal(o.quiet, true);
  assert.equal(parseArgs([]).cmd, "run");
});

// ---------- integration: the analysis pipeline on the fixture ----------
test("pipeline finds every planted event type", () => {
  const opts = { max: 5000, since: null, until: null };
  const events = collectEvents(repo, opts);
  assert.equal(events.length, 10);
  diffScan(repo, events, opts);
  const A = analyze(events, hotspots(repo, opts));

  assert.equal(A.first.subject, "first light");                       // The Call
  assert.equal(A.threshold.subject, "add tests for core math");       // The Threshold (via test-file shape)
  assert.equal(A.reverts.length, 1);                                  // Paths Unwalked
  assert.match(A.reverts[0].subject, /Revert/);
  // the bargain was in the DIFF, not the subject — diff layer must catch it
  const bargain = A.suspEvents.find((e) => e.subject === "tidy module header");
  assert.ok(bargain, "diff-level suppression detected");
  assert.ok(bargain.suppressions.some((s) => s.includes("eslint-disable")));
  assert.ok(A.weaken.some((e) => e.subject === "simplify test harness"), "assertion weakening");
  assert.equal(A.abyss.subject, "remove legacy module wholesale");    // The Abyss
  assert.ok(A.abyss.dels >= 290);
  assert.equal(A.winter.days, 92);                                    // The Long Winter
  assert.ok(A.fragile.some(([k, c]) => c === 2 && k.includes("overflow")), "fragile area ×2");
});

test("renderers include the planted story", () => {
  const opts = { max: 5000, since: null, until: null };
  const events = collectEvents(repo, opts);
  diffScan(repo, events, opts);
  const A = analyze(events, hotspots(repo, opts));

  const hist = renderLogbookMd("fixture", A, false);
  for (const s of ["Do-not-retry", "Suppression ledger", "Assertion-weakening",
    "Fragile areas", "What a fresh session should know", "eslint-disable"])
    assert.ok(hist.includes(s), `LOGBOOK.md has "${s}"`);

  const j = renderJourneyMd("fixture", A);
  for (const s of ["The Call", "The Threshold", "The Abyss", "The Long Winter",
    "Whispered Bargains", "Paths Unwalked", "Logbook Almanac"])
    assert.ok(j.includes(s), `JOURNEY.md has "${s}"`);
  assert.ok(journeyBeats("fixture", A).length >= 7);
  assert.ok(almanacStats(A).some(([k]) => k === "winter"));
});

// ---------- integration: the CLI end-to-end ----------
test("CLI writes the three artifacts and summary", () => {
  const out = execFileSync(process.execPath, [CLI, repo], { encoding: "utf8" });
  for (const f of ["LOGBOOK.md", "events.jsonl", "JOURNEY.md"])
    assert.ok(existsSync(join(repo, f)), `${f} written`);
  assert.match(out, /✓ wrote LOGBOOK\.md/);
  assert.match(out, /10 commits/);
  const lines = readFileSync(join(repo, "events.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 10);
  const ev = JSON.parse(lines[0]);
  for (const k of ["sha", "date", "subject", "shape", "suppressions"]) assert.ok(k in ev);
});

test("CLI journey renders without writing; --json emits JSONL; bad path errors", () => {
  const before = readFileSync(join(repo, "JOURNEY.md"), "utf8");
  const out = execFileSync(process.execPath, [CLI, "journey", repo],
    { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "1" } });
  assert.match(out, /The Journey of/);
  assert.match(out, /ALMANAC/);
  assert.equal(readFileSync(join(repo, "JOURNEY.md"), "utf8"), before, "journey writes nothing");

  const json = execFileSync(process.execPath, [CLI, repo, "--json"], { encoding: "utf8" });
  assert.equal(json.trim().split("\n").length, 10);
  JSON.parse(json.trim().split("\n")[0]);

  let failed = false;
  try { execFileSync(process.execPath, [CLI, mkdtempSync(join(tmpdir(), "notrepo-"))], { encoding: "utf8", stdio: "pipe" }); }
  catch { failed = true; }
  assert.ok(failed, "non-repo exits nonzero");
});

test("--since scopes the era", () => {
  const opts = { max: 5000, since: "2024-04-20", until: null };
  const events = collectEvents(repo, opts);
  assert.equal(events.length, 2); // revert + epilogue only
});

test("-n cap is surfaced, not silent", () => {
  const out = execFileSync(process.execPath, [CLI, repo, "-n", "5"], { encoding: "utf8" });
  assert.match(out, /capped — use -n for more/);
  assert.match(readFileSync(join(repo, "LOGBOOK.md"), "utf8"), /Analysis capped at 5 commits/);
});

test("epoch-1970 commit dates do not poison the winter", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-epoch-"));
  const g = (args, date) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H",
    GIT_COMMITTER_EMAIL: "h@x.io", ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) } });
  g(["init", "-q"]);
  g(["commit", "-q", "--allow-empty", "-m", "one"], "2024-01-01T12:00:00");
  g(["commit", "-q", "--allow-empty", "-m", "broken clock"], "1970-01-01T00:00:01");
  g(["commit", "-q", "--allow-empty", "-m", "three"], "2024-03-01T12:00:00");
  execFileSync(process.execPath, [CLI, d, "-q"], { encoding: "utf8" });
  const j = readFileSync(join(d, "JOURNEY.md"), "utf8");
  assert.ok(!/1[0-9],\d{3} days|19,501/.test(j), "no multi-decade winter");
  const m = /(\d[\d,]*) days of silence/.exec(j);
  if (m) assert.ok(Number(m[1].replace(/,/g, "")) < 400, `winter is ${m[1]} days`);
});

test("fleetPct bounds and --compare renders percentiles", async () => {
  const { fleetPct } = await import("../bin/logbook.mjs");
  assert.equal(fleetPct("reverts_per_1k", 0), 0);
  assert.equal(fleetPct("reverts_per_1k", 99999), 100);
  const lo = fleetPct("bargains_per_1k", 0.1);
  const hi = fleetPct("bargains_per_1k", 50);
  assert.ok(lo < hi, `monotonic: p${lo} < p${hi}`);
  const out = execFileSync(process.execPath, [CLI, "journey", repo, "--compare"],
    { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "1" } });
  assert.match(out, /p\d+/);
  assert.match(out, /percentiles vs the top 2,500 repos/);
});

test("a lone wrong-but-plausible early date does not poison winter/span", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-era-"));
  const g = (args, date) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H",
    GIT_COMMITTER_EMAIL: "h@x.io", ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) } });
  g(["init", "-q"]);
  g(["commit", "-q", "--allow-empty", "-m", "clock bug"], "2005-06-01T12:00:00");
  for (let i = 0; i < 6; i++)
    g(["commit", "-q", "--allow-empty", "-m", `real ${i}`], `2024-0${i + 1}-01T12:00:00`);
  execFileSync(process.execPath, [CLI, d, "-q"], { encoding: "utf8" });
  const j = readFileSync(join(d, "JOURNEY.md"), "utf8");
  const m = /([\d,]+) days of silence/.exec(j);
  if (m) assert.ok(Number(m[1].replace(/,/g, "")) < 400, `winter is ${m[1]} days`);
  const lb = readFileSync(join(d, "LOGBOOK.md"), "utf8");
  assert.ok(!/2005/.test(/\(([\d?-]+) →/.exec(lb)?.[1] || ""), "span starts in era, not 2005");
});

test("notable events surface security reverts and big assertion drops", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-notable-"));
  const g = (args, date) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H",
    GIT_COMMITTER_EMAIL: "h@x.io", ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) } });
  g(["init", "-q"]);
  writeFileSync(join(d, "t.test.js"),
    Array.from({ length: 9 }, (_, i) => `assert.equal(f(${i}), ${i});`).join("\n") + "\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "add tests"], "2024-01-01T12:00:00");
  writeFileSync(join(d, "t.test.js"), "// gutted\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "clean up test harness"], "2024-02-01T12:00:00");
  writeFileSync(join(d, "a.js"), "x\n");
  g(["add", "-A"]);
  g(["commit", "-q", "-m", 'Revert "security patch for CVE-2024-9999"'], "2024-03-01T12:00:00");
  execFileSync(process.execPath, [CLI, d, "-q"], { encoding: "utf8" });
  const lb = readFileSync(join(d, "LOGBOOK.md"), "utf8");
  assert.match(lb, /## Notable events/);
  assert.match(lb, /security-revert.*CVE-2024-9999/);
  assert.match(lb, /-9 asserts.*clean up test harness/);
});

test("per-file history keys reverts/suppressions to hotspot files", () => {
  const opts = { max: 5000, since: null, until: null };
  const events = collectEvents(repo, opts);
  diffScan(repo, events, opts);
  const A = analyze(events, hotspots(repo, opts));
  assert.ok(A.perFile.length >= 1, "at least one hotspot has history");
  const core = A.perFile.find((x) => x.file === "core.js");
  assert.ok(core, "core.js (top fixture hotspot) has a section");
  assert.ok(core.hits.some((e) => e.revert), "its revert is keyed to it");
  const lb = renderLogbookMd("fixture", A, false);
  assert.match(lb, /## History by hotspot file/);
  assert.match(lb, /### core\.js/);
});

test("assertion downgrades (strong→weak) are detected and notable", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-downgrade-"));
  const g = (args, date) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H",
    GIT_COMMITTER_EMAIL: "h@x.io", ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) } });
  g(["init", "-q"]);
  writeFileSync(join(d, "a.test.js"),
    "expect(x).toEqual(1);\nexpect(y).toEqual(2);\nexpect(z).toStrictEqual(3);\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "add tests"], "2024-01-01T12:00:00");
  writeFileSync(join(d, "a.test.js"),
    "expect(x).toBeTruthy();\nexpect(y).toBeDefined();\nexpect(z).toStrictEqual(3);\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "stabilize flaky expectations"], "2024-02-01T12:00:00");
  execFileSync(process.execPath, [CLI, d, "-q"], { encoding: "utf8" });
  const lb = readFileSync(join(d, "LOGBOOK.md"), "utf8");
  assert.match(lb, /2 assert downgrades.*stabilize flaky expectations/);
});

test("audit reports live suppressions with since-dates, ignores removed ones", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-audit-"));
  const g = (args, date) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H",
    GIT_COMMITTER_EMAIL: "h@x.io", ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) } });
  g(["init", "-q"]);
  writeFileSync(join(d, "a.js"), "let x = 1;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "init"], "2020-01-01T12:00:00");
  writeFileSync(join(d, "a.js"), "/* eslint-disable no-unused-vars */\nlet x = 1;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "hush lint"], "2021-06-15T12:00:00");
  writeFileSync(join(d, "b.test.js"), "it.skip('later removed', () => {});\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "skip flaky"], "2022-01-01T12:00:00");
  writeFileSync(join(d, "b.test.js"), "it('restored', () => {});\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "restore test"], "2023-01-01T12:00:00");
  const out = execFileSync(process.execPath, [CLI, "audit", d],
    { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });
  assert.match(out, /eslint-disable.*a\.js:1.*since 2021-06-15/);
  assert.ok(!/it\.skip/.test(out), "removed skip is not reported live");
  assert.match(out, /1 live suppression/);
});

test("audit tags re-silenced suppressions with the fight log", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-fight-"));
  const g = (args, date) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H",
    GIT_COMMITTER_EMAIL: "h@x.io", ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) } });
  g(["init", "-q"]);
  writeFileSync(join(d, "a.test.js"), "it.skip('flaky', () => {});\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "skip flaky"], "2023-01-01T12:00:00");
  writeFileSync(join(d, "a.test.js"), "it('flaky', () => {});\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "fixed it"], "2023-06-01T12:00:00");
  writeFileSync(join(d, "a.test.js"), "it.skip('flaky', () => {});\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "skip again, still flaky"], "2024-01-01T12:00:00");
  const out = execFileSync(process.execPath, [CLI, "audit", d],
    { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });
  assert.match(out, /it\.skip.*a\.test\.js/);
  assert.match(out, /re-silenced ×1 \(\+-\+\)/);
});

test("suppressions inside string literals are mentions, not directives", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-mention-"));
  const g = (args, date) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H",
    GIT_COMMITTER_EMAIL: "h@x.io", ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) } });
  g(["init", "-q"]);
  writeFileSync(join(d, "patterns.js"),
    'const PAT = /eslint-disable|it\\.skip/; const s = "@ts-ignore in a string";\n' +
    "// eslint-disable-next-line no-console\nconsole.log(1);\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "add pattern table + one real directive"], "2024-01-01T12:00:00");
  const out = execFileSync(process.execPath, [CLI, "audit", d],
    { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });
  assert.match(out, /1 live suppression/);
  assert.match(out, /patterns\.js:2/);
  assert.ok(!/ts-ignore/.test(out), "string-literal mention not flagged");
});

test("query filters the record (mirrors the MCP experiment)", () => {
  const out = execFileSync(process.execPath, [CLI, "query", repo, "--revert"], { encoding: "utf8" });
  const rows = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.match(rows[0].subject, /Revert/);
  const out2 = execFileSync(process.execPath, [CLI, "query", repo, "--file", "core.js", "--suppress"], { encoding: "utf8" });
  assert.ok(out2.trim().split("\n").filter(Boolean).length >= 1, "file+suppress filter works");
});

test("ledger cache: reuse, incremental append, window-poisoning guard", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-cache-"));
  const g = (args, date) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H",
    GIT_COMMITTER_EMAIL: "h@x.io", ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) } });
  g(["init", "-q"]);
  for (let i = 0; i < 4; i++) {
    writeFileSync(join(d, "a.js"), `let x = ${i};\n`);
    g(["add", "-A"]); g(["commit", "-q", "-m", `c${i}`], `2024-0${i + 1}-01T12:00:00`);
  }
  execFileSync(process.execPath, [CLI, d, "-q"], { encoding: "utf8" });
  // 1. fresh cache is reused
  let err = execFileSync(process.execPath, [CLI, "query", d, "--grep", "c1"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const r1 = execFileSync(process.execPath, [CLI, "query", d, "--grep", "c1"], { encoding: "utf8" });
  assert.equal(r1.trim().split("\n").length, 1);
  // 2. new commit → incremental path still returns complete, correct results
  writeFileSync(join(d, "a.js"), "let x = 99;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "brand new"], "2024-06-01T12:00:00");
  const r2 = execFileSync(process.execPath, [CLI, "query", d, "--grep", "brand new"], { encoding: "utf8" });
  assert.equal(r2.trim().split("\n").length, 1, "incremental includes the new commit");
  const r3 = execFileSync(process.execPath, [CLI, "query", d, "--grep", "c0"], { encoding: "utf8" });
  assert.equal(r3.trim().split("\n").length, 1, "old commits survive the merge");
  // 3. window-poisoned cache is rejected (write a -n 2 record, ask default)
  execFileSync(process.execPath, [CLI, d, "-q", "-n", "2"], { encoding: "utf8" });
  const r4 = execFileSync(process.execPath, [CLI, "query", d, "--grep", "c0"], { encoding: "utf8" });
  assert.equal(r4.trim().split("\n").length, 1, "capped cache not trusted as full ledger");
  // 4. LOGBOOK_NO_CACHE forces recompute
  const r5 = execFileSync(process.execPath, [CLI, "query", d, "--grep", "c0"],
    { encoding: "utf8", env: { ...process.env, LOGBOOK_NO_CACHE: "1" } });
  assert.equal(r5.trim().split("\n").length, 1);
  // 5. duplicate events on disk self-heal, and an overlapping incremental
  //    range cannot re-add a cached commit (log windows aren't ancestry-closed
  //    — merge-train repos hit this; found on spring-boot: 682 dupes at cap)
  execFileSync(process.execPath, [CLI, d, "-q"], { encoding: "utf8" });
  const evPath = join(d, "events.jsonl");
  const lines5 = readFileSync(evPath, "utf8").trim().split("\n");
  const older = lines5[2]; // duplicate an already-cached older commit
  writeFileSync(evPath, lines5.slice(0, 2).join("\n") + "\n" + older + "\n" + lines5.slice(2).join("\n") + "\n");
  const r6 = execFileSync(process.execPath, [CLI, d, "--json"], { encoding: "utf8" }).trim().split("\n");
  const shas6 = r6.map((l) => JSON.parse(l).fullSha);
  assert.equal(new Set(shas6).size, shas6.length, "no duplicate events after self-heal");
  assert.equal(shas6.length, 5, "all 5 distinct commits present");
  // overlap-merge: stale newest + the range's commit already buried in the
  // cache → incremental merge must not duplicate it
  execFileSync(process.execPath, [CLI, d, "-q"], { encoding: "utf8" });
  const l7 = readFileSync(evPath, "utf8").trim().split("\n");
  writeFileSync(evPath, [l7[1], l7[2], l7[0], l7[3], l7[4]].join("\n") + "\n");
  const r7 = execFileSync(process.execPath, [CLI, d, "--json"], { encoding: "utf8" }).trim().split("\n");
  const shas7 = r7.map((l) => JSON.parse(l).fullSha);
  assert.equal(new Set(shas7).size, shas7.length, "overlapping incremental does not duplicate");
  assert.equal(shas7.length, 5);
  // 6. a merge commit at HEAD must not defeat the cache (ledger records
  //    --no-merges, so staleness compares against the newest non-merge)
  g(["checkout", "-q", "-f", "-b", "side", "HEAD~1"]);
  writeFileSync(join(d, "side.js"), "export const s = 1;\n");
  g(["add", "side.js"]); g(["commit", "-q", "-m", "side work"], "2024-07-01T12:00:00");
  g(["checkout", "-q", "-f", "-"]);
  g(["merge", "-q", "--no-ff", "--no-edit", "side"]);   // HEAD is now a merge
  execFileSync(process.execPath, [CLI, d, "-q"], { encoding: "utf8" }); // absorb side work
  const reused = loadEvents(d, { max: 20000, since: null, until: null });
  assert.ok(reused, "ledger reused under a merge HEAD");
  assert.equal(reused.mode, "cached", "merge-HEAD hits the cached path, not incremental");
  const shas8 = reused.events.map((e) => e.fullSha);
  assert.equal(new Set(shas8).size, shas8.length, "no duplicates under merge HEAD");
});

test("chunked diff scan is equivalent to single-pass", () => {
  const out1 = execFileSync(process.execPath, [CLI, "query", repo, "--suppress"],
    { encoding: "utf8", env: { ...process.env, LOGBOOK_NO_CACHE: "1", LOGBOOK_WINDOW: "2" } });
  const out2 = execFileSync(process.execPath, [CLI, "query", repo, "--suppress"],
    { encoding: "utf8", env: { ...process.env, LOGBOOK_NO_CACHE: "1", LOGBOOK_WINDOW: "100000" } });
  assert.equal(out1, out2, "window size must not change results");
  // a bogus window must fall back to the default, not hang or change output
  const out3 = execFileSync(process.execPath, [CLI, "query", repo, "--suppress"],
    { encoding: "utf8", env: { ...process.env, LOGBOOK_NO_CACHE: "1", LOGBOOK_WINDOW: "-5" }, timeout: 30000 });
  assert.equal(out1, out3, "invalid LOGBOOK_WINDOW falls back to default");
});

test("init wires the repo once, idempotently, into existing agent files", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-init-"));
  const g = (args) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: "h@x.io" } });
  g(["init", "-q"]);
  writeFileSync(join(d, "a.js"), "let x = 1;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "first"]);
  // no agent files → creates AGENTS.md + the Claude Code bridge
  const out = execFileSync(process.execPath, [CLI, "init", d], { encoding: "utf8" });
  assert.match(out, /wired AGENTS\.md/);
  const agents = readFileSync(join(d, "AGENTS.md"), "utf8");
  assert.match(agents, /Repo memory/);
  assert.match(agents, /do-not-retry/);
  // Claude Code reads CLAUDE.md, not AGENTS.md — fresh repos get the import bridge
  assert.equal(readFileSync(join(d, "CLAUDE.md"), "utf8"), "@AGENTS.md\n", "bridge created");
  // second init → no duplicate block, bridge untouched (wired via import)
  execFileSync(process.execPath, [CLI, "init", d], { encoding: "utf8" });
  assert.equal(readFileSync(join(d, "AGENTS.md"), "utf8").split("Repo memory").length - 1, 1, "idempotent");
  assert.equal(readFileSync(join(d, "CLAUDE.md"), "utf8"), "@AGENTS.md\n", "bridge not re-blocked");
  rmSync(join(d, "CLAUDE.md"));
  // existing CLAUDE.md gets appended without touching its content
  writeFileSync(join(d, "CLAUDE.md"), "# My rules\nBe nice.\n");
  execFileSync(process.execPath, [CLI, "init", d], { encoding: "utf8" });
  const claude = readFileSync(join(d, "CLAUDE.md"), "utf8");
  assert.match(claude, /^# My rules/);
  assert.match(claude, /Repo memory/);
  // AGENTS.override.md shadows AGENTS.md in Codex — must get wired too
  writeFileSync(join(d, "AGENTS.override.md"), "override rules\n");
  execFileSync(process.execPath, [CLI, "init", d], { encoding: "utf8" });
  assert.match(readFileSync(join(d, "AGENTS.override.md"), "utf8"), /Repo memory/);
  // sentinel is the block header, not any LOGBOOK.md mention
  writeFileSync(join(d, "AGENTS.md"), "Do not commit LOGBOOK.md\n");
  execFileSync(process.execPath, [CLI, "init", d], { encoding: "utf8" });
  assert.match(readFileSync(join(d, "AGENTS.md"), "utf8"), /Repo memory/,
    "unrelated LOGBOOK.md mention must not suppress wiring");
  // nested CWD: analysis resolves to the git root, artifacts land there
  mkdirSync(join(d, "pkg", "sub"), { recursive: true });
  execFileSync(process.execPath, [CLI, "."], { encoding: "utf8", cwd: join(d, "pkg", "sub") });
  assert.ok(existsSync(join(d, "LOGBOOK.md")), "artifacts at root from nested cwd");
  assert.ok(!existsSync(join(d, "pkg", "sub", "LOGBOOK.md")), "nothing written in nested dir");
  rmSync(d, { recursive: true, force: true });
});

test("annotate: persists a why, merges into LOGBOOK.md with provenance, last write wins", () => {
  const o = parseArgs(["annotate", "abc123", "because reasons", repo, "--by", "tester"]);
  assert.equal(o.cmd, "annotate");
  assert.equal(o.sha, "abc123");
  assert.equal(o.why, "because reasons");
  assert.equal(o.repo, repo);
  assert.equal(o.by, "tester");

  const revertSha = git(["log", "--format=%H", "--grep=Revert"]).trim();
  execFileSync(process.execPath,
    [CLI, "annotate", revertSha.slice(0, 8), "the header tidy silenced a real lint error", repo, "--by", "tester"],
    { encoding: "utf8" });
  const out = execFileSync(process.execPath, [CLI, repo], { encoding: "utf8" });
  assert.match(out, /1 why/);
  const lb = readFileSync(join(repo, "LOGBOOK.md"), "utf8");
  assert.match(lb, /why \(inferred by tester, \d{4}-\d{2}-\d{2}\): the header tidy silenced a real lint error/);
  assert.match(lb, /agent-inferred judgments/, "disclaimer rendered when whys present");

  // last write per sha wins; annotating by prefix resolves to the same full sha
  saveAnnotation(repo, repo, { sha: revertSha.slice(0, 8), why: "updated verdict", by: "tester2" });
  const notes = loadAnnotations(repo);
  assert.equal(notes.length, 1, "same commit annotated twice → one note");
  assert.equal(notes[0].why, "updated verdict");
  assert.equal(notes[0].sha, revertSha);
  // identical annotation is idempotent: the FILE must not grow either
  const linesBefore = readFileSync(join(repo, "annotations.jsonl"), "utf8").trim().split("\n").length;
  saveAnnotation(repo, repo, { sha: revertSha.slice(0, 8), why: "updated verdict", by: "tester2" });
  saveAnnotation(repo, repo, { sha: revertSha.slice(0, 8), why: "updated verdict", by: "tester2" });
  const linesAfter = readFileSync(join(repo, "annotations.jsonl"), "utf8").trim().split("\n").length;
  assert.equal(linesAfter, linesBefore, "identical writes are no-ops");

  // annotate merges into an existing LOGBOOK.md IMMEDIATELY (a later session
  // that finds fresh artifacts on disk may never re-run the CLI)
  const out2 = execFileSync(process.execPath,
    [CLI, "annotate", revertSha.slice(0, 8), "immediate merge verdict", repo, "--by", "tester3"],
    { encoding: "utf8" });
  assert.match(out2, /merged into LOGBOOK\.md(?! on the next run)/, "reports immediate merge");
  assert.match(readFileSync(join(repo, "LOGBOOK.md"), "utf8"), /immediate merge verdict/,
    "LOGBOOK.md carries the why without another run");

  // a why on a commit outside every rendered section still surfaces (never
  // silently truncated) — "first light" is no revert/suppression/weakening
  const firstSha = git(["log", "--format=%H", "--reverse"]).trim().split("\n")[0];
  execFileSync(process.execPath,
    [CLI, "annotate", firstSha, "the repo began as a calculator", repo, "--by", "tester4"],
    { encoding: "utf8" });
  const lb2 = readFileSync(join(repo, "LOGBOOK.md"), "utf8");
  assert.match(lb2, /## Annotated commits/, "leftover section renders");
  assert.match(lb2, /the repo began as a calculator/);

  // unknown sha is rejected, exit 1
  assert.throws(() =>
    execFileSync(process.execPath, [CLI, "annotate", "deadbeef1234", "nope", repo], { encoding: "utf8", stdio: "pipe" }));

  // malformed lines are skipped, not fatal (2 valid notes: revert + first)
  writeFileSync(join(repo, "annotations.jsonl"), "not json\n", { flag: "a" });
  assert.equal(loadAnnotations(repo).length, 2);
  rmSync(join(repo, "annotations.jsonl"));
});

test("committing a detector regex table is not suppression history", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-selfref-"));
  const g = (args) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: "h@x.io" } });
  g(["init", "-q"]);
  writeFileSync(join(d, "a.js"), "let x = 1;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "base"]);
  // a bare regex-literal continuation line — exactly how logbook's own
  // SUPPRESS_PAT is committed; the diff's + prefix must not hide it from isMention
  writeFileSync(join(d, "detect.js"),
    "export const SUPPRESS_PAT =\n  /@ts-nocheck|@ts-ignore|eslint-disable|\\bit\\.skip\\b|\\btest\\.skip\\b/g;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "add detector patterns"]);
  // comments ABOUT call-syntax idioms are prose, not directives
  writeFileSync(join(d, "notes.js"),
    "// never use describe.skip or xit( here\nlet ok = 1; // t.Skip( is Go-only\n");
  writeFileSync(join(d, "notes.py"), "x = 1  # drop @pytest.mark.skip before merge\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "document conventions"]);
  // a REAL directive in the same repo must still count — including the
  // comment-directive family, whose home IS a comment
  writeFileSync(join(d, "a.js"), "/* eslint-disable no-console */\nlet x = 1;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "quiet header"]);
  const out = execFileSync(process.execPath, [CLI, "query", d, "--suppress"],
    { encoding: "utf8", env: { ...process.env, LOGBOOK_NO_CACHE: "1" } });
  const evs = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(evs.length, 1, "only the live directive counts, not the regex table");
  assert.match(evs[0].subject, /quiet header/);
  assert.deepEqual(evs[0].suppressions, ["eslint-disable"]);
  rmSync(d, { recursive: true, force: true });
});

test("extractor version gates the cache: stale ledgers rebuild clean", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-xv-"));
  const g = (args) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: "h@x.io" } });
  g(["init", "-q"]);
  writeFileSync(join(d, "a.js"), "let x = 1;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "base"]);
  writeFileSync(join(d, "b.js"), "let y = 2;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "more"]);
  execFileSync(process.execPath, [CLI, d, "-q"], { encoding: "utf8" });
  const evPath = join(d, "events.jsonl");
  const stamped = readFileSync(evPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(stamped.every((e) => e.xv === EXTRACTOR_VERSION), "every event carries the extractor version");
  // stamped at BIRTH, not at write: library consumers (MCP) skip the CLI entrypoint
  const born = collectEvents(d, { max: 20000, since: null, until: null });
  assert.ok(born.every((e) => e.xv === EXTRACTOR_VERSION), "collectEvents stamps events directly");
  // simulate a pre-versioning ledger holding a stale false classification
  const doctored = stamped.map((e) => {
    const { xv, ...rest } = e;
    return JSON.stringify({ ...rest, suppressions: ["@ts-nocheck"] });
  });
  writeFileSync(evPath, doctored.join("\n") + "\n");
  assert.equal(loadEvents(d, { max: 20000, since: null, until: null }), null,
    "old-extractor cache is rejected, not reused");
  execFileSync(process.execPath, [CLI, d, "-q"], { encoding: "utf8" });
  const rebuilt = readFileSync(evPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(rebuilt.every((e) => e.suppressions.length === 0), "stale classifications do not survive the upgrade");
  assert.ok(rebuilt.every((e) => e.xv === EXTRACTOR_VERSION));
  // public JSON is cache-invariant: same repo + HEAD must serialize
  // identically whether events come from the ledger or a fresh scan
  const jCached = execFileSync(process.execPath, [CLI, d, "--json"], { encoding: "utf8" });
  const jFresh = execFileSync(process.execPath, [CLI, d, "--json"],
    { encoding: "utf8", env: { ...process.env, LOGBOOK_NO_CACHE: "1" } });
  assert.equal(jCached, jFresh, "cached and no-cache --json are byte-identical");
  const q = execFileSync(process.execPath, [CLI, "query", d, "--grep", "base"], { encoding: "utf8" });
  assert.equal(JSON.parse(q.trim()).xv, EXTRACTOR_VERSION, "query events carry the schema version");
  rmSync(d, { recursive: true, force: true });
});

test("init migrates the old --by codex block; user-edited blocks stay", () => {
  const d = mkdtempSync(join(tmpdir(), "logbook-migrate-"));
  const g = (args) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: "h@x.io" } });
  g(["init", "-q"]);
  writeFileSync(join(d, "a.js"), "let x = 1;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "base"]);
  const oldBlock = `\n## Repo memory\nRead LOGBOOK.md (at the repo root) before proposing changes. If its\nHistorical signal is LOW, treat it as a hotspot map; otherwise check the\ndo-not-retry list and fragile areas before any large change. Refresh with:\nnpx -y @promptwheel/logbook\nCheck what is still silenced: npx -y @promptwheel/logbook audit\nWhen you investigate WHY a listed commit happened and verify it in the\ndiffs, persist it (replace SHA and the sentence; never annotate guesses):\nnpx -y @promptwheel/logbook annotate SHA "one specific sentence" --by codex\n`;
  writeFileSync(join(d, "AGENTS.md"), "# mine\n" + oldBlock);
  writeFileSync(join(d, "CLAUDE.md"), "## Repo memory\nmy own custom wording — hands off\n");
  const out = execFileSync(process.execPath, [CLI, "init", d], { encoding: "utf8" });
  assert.match(out, /updated AGENTS\.md/);
  const agents = readFileSync(join(d, "AGENTS.md"), "utf8");
  assert.match(agents, /^# mine/, "user content above the block survives");
  assert.doesNotMatch(agents, /--by codex/, "cross-agent misattribution migrated away");
  assert.match(agents, /--by MODEL/);
  assert.equal(agents.split("## Repo memory").length - 1, 1, "no duplicate block");
  assert.equal(readFileSync(join(d, "CLAUDE.md"), "utf8"),
    "## Repo memory\nmy own custom wording — hands off\n", "edited block untouched");
  // a second init after migration is a no-op, not a re-migration
  execFileSync(process.execPath, [CLI, "init", d], { encoding: "utf8" });
  assert.equal(readFileSync(join(d, "AGENTS.md"), "utf8").split("## Repo memory").length - 1, 1);
  rmSync(d, { recursive: true, force: true });
});

test("audit on a suppression-free repo is clean, not an error", () => {
  // regression: git() discarded the exit status, so grep's "no matches"
  // (exit 1) was indistinguishable from a real failure and audit threw
  const d = mkdtempSync(join(tmpdir(), "logbook-cleanaudit-"));
  const g = (args) => execFileSync("git", ["-C", d, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: "h@x.io", GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: "h@x.io" } });
  g(["init", "-q"]);
  writeFileSync(join(d, "a.js"), "let x = 1;\n");
  g(["add", "-A"]); g(["commit", "-q", "-m", "base"]);
  const out = execFileSync(process.execPath, [CLI, "audit", d], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /clean — no live suppressions/);
  rmSync(d, { recursive: true, force: true });
});
