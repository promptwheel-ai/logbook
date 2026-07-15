# logbook — agent notes

Single-file zero-dep CLI (`bin/logbook.mjs`) + MCP wrapper (`mcp/server.mjs`).
Run tests: `npm test` (root) and `cd mcp && npm test` (behavioral, drives the
real server over stdio). Inside this repo use `node bin/logbook.mjs`, not
npx — npm prefers the same-name local package and shadows the registry.

## Release invariants (regression-tested — keep all of them green)

1. A fresh self-run on THIS repo reports **0 suppression events**. The
   detector must never flag its own regex tables or comments about skip
   APIs (diff `+/-` prefix is stripped before `isMention`; call-syntax
   idioms inside comments are prose).
2. Bump `EXTRACTOR_VERSION` whenever detector precision changes — the
   events.jsonl cache is rejected on mismatch, so old ledgers can't mask a
   fix. Verify fresh and upgraded-cache self-runs agree.
3. Public JSON is cache-invariant: `--json` (and MCP `logbook_query`)
   byte-identical with and without `LOGBOOK_NO_CACHE=1`. Events are
   stamped with `xv` at birth in `collectEvents`, not at write time.
4. Cache freshness is the exact current ordered non-merge Git window, never
   “newest cached SHA is present.” Merges can introduce older-dated side
   commits; reuse rows by immutable full SHA, scan missing SHAs, then restore
   Git's canonical order.
5. `init` writes the ordered read → bounded path-context → verify → diff-check
   workflow with neutral `--by MODEL` attribution and creates the CLAUDE.md
   `@AGENTS.md` bridge; exact released blocks migrate, user-edited blocks are
   never touched.
6. `DEFAULT_MAX` is the single source for the commit window — the ledger
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
10. The decision system is plane-only: local inert `.logbook/drafts/`,
    policy-published `.logbook/leads/`, human-reviewed
    `.logbook/decisions/`, and byte-bound `.logbook/reviews/`. Keep one
    authority/read path.
11. In range mode, `check --diff` reads authority from the pinned base commit;
    local mode pins `HEAD`. A PR must never approve its own card. Malformed,
    missing, non-ancestral, or unverifiable trust data is unmeasurable—not
    clean—and exits nonzero.
12. Grounding proves evidence bytes exist at the named commit side/path. It
    never proves the model's interpretation, causality, or current
    applicability. Policy publication creates a labeled machine lead, never a
    human-reviewed decision.
13. Review authority comes from the trusted Git commit/branch protection.
    `--by` is attribution only. Human-reviewed rendering requires an exact
    matching review record for the canonical decision bytes.
14. `check --diff` is bounded before expensive per-card validation (20 rows /
    8 KiB with an opaque cursor), and metrics are aggregate-only. Do not add
    semantic confidence routing to the release path.

## Release policy

Changes are caused by evidence, not comment velocity. Blockers ship
immediately; noncritical fixes batch; features remain demand-gated. The 0.9
decision layer is an instrumented alpha, not a lifecycle-complete platform:
first-class revise/retire commands for accepted decisions remain deferred.

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
   Inspect task-relevant do-not-retry, test-trust, and decision-lead entries
   regardless of repo-wide totals.
3. For complete do-not-retry coverage, inspect all relevant paths:
   node bin/logbook.mjs context --file path/to/file --revert
   Repeat --file for each other relevant path. If output says NEXT, repeat the
   identical filters with --cursor TOKEN until END complete before concluding.
4. Treat findings as leads, not verdicts. Verify claims with git show SHA and
   confirm that the constraint still applies to the current tree.
Refresh the record: node bin/logbook.mjs
Check what is still silenced: node bin/logbook.mjs audit
When you investigate WHY a listed commit happened and verify it in raw Git,
persist an inert, evidence-bearing draft (replace placeholders; never annotate
guesses):
node bin/logbook.mjs annotate-draft SHA "one specific sentence" --span "exact bytes" --side diff --evidence-file path/to/file --by MODEL
Then run `node bin/logbook.mjs pending` and report the full card ID. Never run
`accept`, `accept-draft`, `accept-lead`, or `reject-lead` for the human.
Before finalizing work, run `node bin/logbook.mjs check --diff` and follow every
NEXT cursor. Treat policy-published cards as machine leads, not human decisions.
