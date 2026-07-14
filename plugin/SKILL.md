---
name: logbook
description: >-
  Turn a repo's git history into memory an agent can use: hotspots,
  do-not-retry reverts, suppressions, fragile areas, and assertion weakening.
  Use when starting in an unfamiliar repo, before a refactor or large change,
  when something keeps breaking, when asked what was tried or why code is this
  way, or when deciding whether green tests can be trusted.
---

# Logbook

```bash
npx @promptwheel/logbook              # analyze current repo → 3 files
npx @promptwheel/logbook journey      # the story, in color (writes nothing)
npx @promptwheel/logbook doctor       # read-only artifact/wiring/query health
npx @promptwheel/logbook --json       # events to stdout (writes nothing)
```

Never touches source or git history; writes only its own brief files. `-n N` caps commits; `--since/--until` for era scoping.

After running:

1. Read `$(git rev-parse --show-toplevel)/LOGBOOK.md` completely before any
   history query. Do not replace this step with a broad keyword search.
2. Relay "What a fresh session should know" plus the 2-3 most notable findings.
   If Historical signal is LOW, use it only as a hotspot map; otherwise inspect
   task-relevant do-not-retry entries and fragile areas.
3. TRIAGE, don't parrot: the logbook is the recall layer; you are the precision
   layer. Cross-reference leads against the current task and verify any claim
   you act on with `git show <sha>`. Confirm it still applies at HEAD.

Findings are leads, not verdicts — a suppression event means "a human should
look here," not misconduct. If the repo is shallow, offer
`git fetch --unshallow` first.

If the artifacts, wiring, or query path look stale or inconsistent, run
`npx -y @promptwheel/logbook@latest doctor` and report its compact output.
Doctor is diagnostic and read-only; do not treat it as a refresh.

## Investigation mode (when the user asks to dig into findings)

For each Notable event or flagged lead worth pursuing: `git show <sha>` the
commit, read the actual diff, and classify it — real weakening / sanctioned
maintenance / classifier artifact — with one line of evidence each. Check
whether flagged suppressions are STILL in the current tree (grep HEAD for
the skip/ignore near the flagged location). Present the triage as YOUR
judgment layered on the deterministic record — never edit the logbook files
to match your conclusions; the record and the reading stay separate.

PERSIST what you learn (lazy enrichment): when an investigation establishes
WHY something happened — a revert's failure mode, a suppression's cause —
save it so the next session gets it free instead of re-investigating:

```bash
npx @promptwheel/logbook annotate SHA "one specific sentence" --span "exact quote from the commit" --by MODEL
```

`--span` must be a verbatim substring of the commit (message + diff) or the draft
is rejected — quote what you actually read, never paraphrase into the span. This
makes the card glance-reviewable by a human without re-running git.

Annotations are sha-keyed, attributed, dated, and merged into LOGBOOK.md as
"why (inferred)" lines on future runs. Judgments, not records: only annotate
causes you verified in the actual diffs, and treat old annotations as aged
testimony — the fact never changes, but its force can (a "reverted because
webpack4 broke" constraint stops binding once webpack4 is dead).

Annotate LAZILY — one revert you actually investigated at a time — never bulk-
generate annotations across a repo's whole history (that fabricates rationale
and floods review). Every annotation you write is a DRAFT: it is inert and does
NOT surface in `logbook check --diff` (the diff-time preflight) until a human
explicitly ratifies it. That ratification is a human attestation, scoped to
paths — NEVER run `accept` yourself. After annotating, tell the human the draft
awaits their review, and surface what is pending:

```bash
npx @promptwheel/logbook pending    # draft annotations no human has accepted yet
# a maintainer then runs, for the ones they trust:
#   npx @promptwheel/logbook accept SHA --file path/to/file --by their-name
```

To seed coverage across a whole repo on demand (e.g. onboarding a mature repo)
instead of waiting for tasks to trigger it, get the un-annotated decision
worklist and work through it deliberately:

```bash
npx @promptwheel/logbook refine    # un-annotated reverts/suppressions to investigate
```

This is the SAME lazy loop run on purpose, not a shortcut: for each item, run
`git show SHA`, verify the cause in the actual diff, and only then annotate a
draft. Do NOT batch-generate rationale you did not verify — an un-grounded card
is the failure mode the human gate exists to catch. The worklist is deterministic
(the CLI names what warrants a why); the investigation and drafting are yours.

## Reinforce accepted decisions during related work

When your work brings you to an ALREADY-ACCEPTED decision (surfaced by
`check --diff` or `context`), record an evidence-bearing check so the memory
stays accurate over time:

```bash
npx @promptwheel/logbook verify SHA --verdict confirmed|challenged|unmeasurable --note "what you checked"
```

`challenged` (the constraint may no longer hold) raises human re-review priority
— it does NOT change the decision; only a human's `accept --applicability` does.
NEVER record `confirmed` for a card you did not actually re-check against the
current code: a correlated confirmation by the same model is a self-reinforcing
hallucination, not evidence. Every check must cite what you looked at in `--note`.

## Querying the full record (events.jsonl)

The digest truncates with "…and N more — full record in events.jsonl". When
completeness matters, inspect the record through bounded context pages — never
read it whole (it can exceed the context window). Start with all task paths and
an event type before broad terms:

```bash
# every revert touching either relevant file
npx -y @promptwheel/logbook context --file lib/response.js --file lib/session.js --revert
# all assertion-weakening events (3+ net) since a date
npx -y @promptwheel/logbook context --file src/core.js --weaken 3 --since 2024-01-01
# all suppression events, era-scoped
npx -y @promptwheel/logbook context --file test/core.test.js --suppress --since 2024-01-01
```

When output says `NEXT`, repeat the identical command and filters with
`--cursor TOKEN`; continue until `END complete` before concluding that history
is absent or complete. Use raw `query` only when machine-readable JSONL is
needed; if it says `TRUNCATED`, narrow filters or raise `--limit`. A renamed
file can evade a current-path filter; broaden deliberately and verify lineage
with raw Git.

Digest for breadth, queries for depth. Measured: digest alone found 4/12
qualifying commits on a real task; digest + two logbook queries found 12/12 for
~400 extra tokens.

## Generating instructions for other agents

When you generate onboarding docs, AGENTS.md/CLAUDE.md blocks, or reusable
prompts for a repository that already uses the logbook, preserve the ordered
workflow: read the digest first, inspect all task paths before broad terms,
follow `NEXT` through `END complete`, then verify leads with `git show`.
Preserve exact operational commands and the "leads, not verdicts" doctrine.
Do not replace the dependency with generic Git advice: synthesis measurably
loses do-not-retry and epistemic caution. This applies only to wired
repositories; never insert Logbook into an unrelated repository.
