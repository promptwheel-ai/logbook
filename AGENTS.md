# logbook - agent notes

Single-file zero-dep CLI (`bin/logbook.mjs`) + MCP wrapper (`mcp/server.mjs`).
Run tests: `npm test` (root) and `cd mcp && npm test` (behavioral, drives the
real server over stdio). Inside this repo use `node bin/logbook.mjs`, not
npx - npm prefers the same-name local package and shadows the registry.

## Release invariants (regression-tested - keep all of them green)

1. A fresh self-run on THIS repo reports **0 suppression events**. The
   detector must never flag its own regex tables or comments about skip
   APIs (diff `+/-` prefix is stripped before `isMention`; call-syntax
   idioms inside comments are prose).
2. Bump `EXTRACTOR_VERSION` whenever detector precision changes - the
   events.jsonl cache is rejected on mismatch, so old ledgers can't mask a
   fix. Verify fresh and upgraded-cache self-runs agree.
3. Public JSON is cache-invariant: `--json` (and MCP `logbook_query`)
   byte-identical with and without `LOGBOOK_NO_CACHE=1`. Events are
   stamped with `xv` at birth in `collectEvents`, not at write time.
4. Cache freshness is the exact current ordered non-merge Git window, never
   “newest cached SHA is present.” Merges can introduce older-dated side
   commits; reuse rows by immutable full SHA, scan missing SHAs, then restore
   Git's canonical order.
5. `init` writes the lean deterministic workflow only: read LOGBOOK.md →
   bounded `context --file` pages per task path to END complete → verify with
   `git show` → refresh, `audit`, and `annotate` with neutral `--by MODEL`
   attribution; it creates the CLAUDE.md `@AGENTS.md` bridge. `doctor` requires
   exactly the lean lines. Exact released blocks migrate (every plane-template
   pin stays in `LEGACY_BLOCKS`, naming commands that no longer exist, so old
   wiring is rewritten rather than stranded), user-edited blocks are never
   touched.
6. `DEFAULT_MAX` is the single source for the commit window - the ledger
   cache gate in `loadEvents` depends on it.
7. Never turn "unmeasurable" into clean: a failed diff scan sets
   `A.degraded` (surfaced in LOGBOOK.md); a failed `git grep` in audit
   throws instead of reporting clean.
8. All repository-controlled Markdown and agent-facing audit values go through
   the single `sanitizeContextText` implementation. Rendering must never mutate
   `events.jsonl`, `--json`, or query output.
9. Generated artifacts use atomic per-file replacement and one shared stamped
   record. `logbook doctor` is read-only and must fail stale/tampered bundles or
   shadowing wiring without repairing them while it checks.
10. Root `annotations.jsonl` is an unreviewed recall channel: render it in the
    digest, never present it as verified. Grounding proves evidence bytes exist
    at the named commit side/path. It never proves the model's interpretation,
    causality, or current applicability.
11. Files left by the removed decision layer (`.logbook/`,
    `decision-cards.jsonl`, `annotation-reviews.jsonl`) are ignored, never read
    and never an error. `GEN_PAT` keeps them classified as generated.

## Release policy

Changes are caused by evidence, not comment velocity. Blockers ship
immediately; noncritical fixes batch; features remain demand-gated.

## Release gate

Root + mcp tests green → fresh self-run 0 suppressions → stale-ledger
upgrade agrees → bump versions (core, and mcp if its contract changed;
mcp's dep range must require the core it needs) → push, CI green →
publish → cold-check from the registry (npx in a NEUTRAL cwd; npx inside
a clone of this repo resolves the local package).

## Repo memory
Before planning or editing:
1. Read LOGBOOK.md at the repo root completely before any history query.
2. Use the raw history inventory as orientation, not a task-level risk score.
   Inspect task-relevant do-not-retry and test-trust entries regardless of
   repo-wide totals.
3. For complete do-not-retry coverage, inspect all relevant paths:
   node bin/logbook.mjs context --file path/to/file --revert
   Repeat --file for each other relevant path. If output says NEXT, repeat the
   identical filters with --cursor TOKEN until END complete before concluding.
4. Treat findings as leads, not verdicts. Verify claims with
   `GIT_GRAFT_FILE=/dev/null git --no-replace-objects show SHA` and
   confirm that the constraint still applies to the current tree.
Refresh the record: node bin/logbook.mjs
Check what is still silenced: node bin/logbook.mjs audit
When you investigate WHY a listed commit happened and verify it in the diffs,
persist it immediately as an unreviewed digest note (replace placeholders;
never annotate guesses):
node bin/logbook.mjs annotate SHA "one specific sentence" --by MODEL
