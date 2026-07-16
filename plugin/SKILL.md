---
name: logbook
description: >-
  Turn a repo's git history into immediate agent memory plus optional reviewed
  temporal decisions: hotspots, do-not-retry reverts, suppressions, fragile
  areas, unreviewed notes, and path-scoped cards. Use when starting in an unfamiliar repo, before a
  refactor or large change, when something keeps breaking, when asked what was
  tried or why code is this way, or when deciding whether green tests can be
  trusted.
---

# Logbook

```bash
npx -y @promptwheel/logbook@0.9.1              # refresh history and render any existing notes
npx -y @promptwheel/logbook@0.9.1 journey      # the story, in color (writes nothing)
npx -y @promptwheel/logbook@0.9.1 doctor       # read-only artifact/wiring/query health
npx -y @promptwheel/logbook@0.9.1 --json       # events to stdout (writes nothing)
```

The CLI runs locally and never changes source or Git history. It writes its own
history artifacts; explicit `annotate` calls append root `annotations.jsonl`,
and explicit decision commands write only under `.logbook/`.

## Required workflow

After locating task-relevant files:

1. Read `$(git rev-parse --show-toplevel)/LOGBOOK.md` before finalizing a plan.
2. Use the raw history inventory as orientation, not a task-level risk score.
3. Inspect every task path through bounded context pages:

   ```bash
   npx -y @promptwheel/logbook@0.9.1 context --file src/a.ts --file src/b.ts --revert
   ```

   If output says `NEXT`, repeat the identical filters with `--cursor TOKEN`
   until `END complete` before concluding history is absent.
4. Treat findings as leads, not verdicts. Verify every material claim with
   `git show SHA` and confirm it still applies to the current tree.
5. Before finalizing a change, run the decision preflight for the actual diff:

   ```bash
   npx -y @promptwheel/logbook@0.9.1 check --diff
   # in a PR/CI range:
   npx -y @promptwheel/logbook@0.9.1 check --diff --base BASE --head HEAD
   ```

   Follow every `NEXT` cursor. Intermediate pages exit nonzero because later
   cards are unchecked; only `END complete` can finish cleanly.

If artifacts or wiring look stale, run
`npx -y @promptwheel/logbook@0.9.1 doctor`. Doctor is read-only; do not treat
it as a refresh.

## Decision authority

Logbook has four storage planes:

- `.logbook/drafts/` — local, gitignored, inert proposals;
- `.logbook/leads/` — committed policy-published machine leads;
- `.logbook/decisions/` — committed human-reviewed decisions; and
- `.logbook/reviews/` — committed reviewer provenance bound to exact bytes.

`check --diff` labels machine leads as lower authority. A decision is
`human-reviewed` only when its exact card bytes have a matching review record
on the trusted Git ref. In a range check, the base commit supplies trust, so a
PR cannot approve itself.

Never infer authority from model confidence. Mechanical grounding proves only
that a quote occurs in the named commit message, or was introduced/removed in
the named changed file. It does not prove the interpretation, causality, or
current applicability.

The committed ref and its branch protections are the authority boundary.
`--by` is attribution, not identity proof.

## Lazy enrichment: preserve what you actually investigate

When related work causes you to investigate why a prior change happened,
persist the verified result immediately as an explicitly unreviewed digest
note. Do not prompt a human and never annotate a guess:

```bash
npx -y @promptwheel/logbook@0.9.1 annotate SHA "one specific claim" \
  --span "exact bytes introduced or removed" \
  --side diff \
  --evidence-file path/to/file \
  --by MODEL
```

For commit-message evidence, use `--side message` and omit
`--evidence-file`. Evidence is optional for the low-friction note, but any
supplied quote must ground exactly or the command abstains. The note appears in
`LOGBOOK.md` immediately, is always labeled machine-authored and unreviewed,
and is never consumed by `check --diff`.

Never paraphrase into `--span`, stitch excerpts, or attach an attractive claim
to an unrelated real substring. Preserve one decision you actually
investigated at a time; do not bulk-generate rationale across history.

### Optional human-reviewed card

Only when a finding specifically needs repository authority, create a separate
inert card and report its full ID:

```bash
npx -y @promptwheel/logbook@0.9.1 annotate-draft SHA "one specific claim" \
  --span "exact bytes" --side diff --evidence-file path/to/file --by MODEL
npx -y @promptwheel/logbook@0.9.1 pending
# Human-only:
# npx -y @promptwheel/logbook@0.9.1 accept-draft FULL_CARD_ID --by HUMAN
```

Never run `accept`, `accept-draft`, `accept-lead`, or `reject-lead` on the
human's behalf. Those commands record human disposition; `accept` is only a
compatibility alias for `accept-draft`.

To seed a mature repository on demand, use the deterministic worklist:

```bash
npx -y @promptwheel/logbook@0.9.1 refine
```

`refine` names unannotated notable commits. It does not generate claims. Work
each item through the same inspect → verify → cite → annotate loop.

## Policy-published machine leads

A repository owner may opt into automatic lower-authority publication with a
committed `.logbook/policy.toml`. Only when that policy is already enabled and
the task calls for automatic publication may an agent pass candidate JSON to:

```bash
npx -y @promptwheel/logbook@0.9.1 publish --candidates candidates.json
```

The CLI independently reloads the committed policy and enforces source
ancestry, raw-object grounding, allowed/protected scopes, quotas, and the
`.logbook/AUTOMATION_DISABLED` kill switch. Published cards remain machine
leads; policy publication never makes them human-reviewed.

Do not treat `logbook outcomes` as semantic accuracy. It reports only the
Git-observable disposition funnel: accepted as-is, accepted with edits,
explicitly rejected, pending, or vanished without review (unmeasurable).

## Related-work reinforcement

There is deliberately no machine `verify` command and no confirmation counter.
Repeated confirmations from the same model are correlated and can create a
self-reinforcing hallucination.

When current work contradicts or ages a surfaced decision:

1. gather concrete evidence;
2. report the conflict and card ID to the human;
3. do not silently edit, retire, or promote the card.

This release supports initial drafting/promotion and machine-lead
accept/edit/reject. It does not yet provide first-class commands to revise or
retire an already accepted decision. A manual edit breaks the review binding
and therefore cannot remain authoritative.

## Investigation mode

For each notable event worth pursuing, inspect `git show SHA`, read the actual
diff, and classify it as real weakening, sanctioned maintenance, or classifier
artifact with one line of evidence. Check whether suppressions are still in
HEAD. Present your judgment layered on the deterministic record; never edit
generated history artifacts to match your conclusion.

## Querying the full event record

Use bounded `context` pages for agent consumption:

```bash
npx -y @promptwheel/logbook@0.9.1 context --file lib/response.js --file lib/session.js --revert
npx -y @promptwheel/logbook@0.9.1 context --file src/core.js --weaken 3 --since 2024-01-01
npx -y @promptwheel/logbook@0.9.1 context --file test/core.test.js --suppress --since 2024-01-01
```

Use raw `query` only when machine-readable JSONL is required. If it says
`TRUNCATED`, narrow filters or raise `--limit`. Renames can evade a current-path
filter; broaden deliberately and verify lineage with raw Git.

## Generating instructions for other agents

Preserve the ordered workflow: locate task paths, read the brief, inspect all
task paths through `NEXT` to `END complete`, verify leads with `git show`, then
run `check --diff`. Preserve the authority-tier labels and “leads, not
verdicts” doctrine. Never replace the dependency with generic Git advice in a
repo already wired for Logbook.
