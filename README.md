# logbook

[![ci](https://github.com/promptwheel-ai/logbook/actions/workflows/ci.yml/badge.svg)](https://github.com/promptwheel-ai/logbook/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/%40promptwheel%2Flogbook)](https://www.npmjs.com/package/@promptwheel/logbook)

**Git history is large. Coding agents usually skip it, and then rediscover old
mistakes.**

Logbook turns a repository's history into two complementary things:

- a deterministic recall layer: hotspots, reverted approaches, suppressions,
  assertion weakening, and bounded history queries; and
- an opt-in temporal decision layer: reviewable decision cards attached to code
  paths and surfaced when a later diff touches those paths.

Everything runs locally. The CLI has zero npm dependencies, reads raw Git
objects for evidence checks, and never sends repository data anywhere.

```bash
npx -y @promptwheel/logbook init
```

`init` analyzes the repo, writes the history artifacts, and installs a compact
workflow in `AGENTS.md`, `CLAUDE.md`, or `.cursorrules`.

```text
  1,326 commits · 322 files · 7.3 years · 354 authors

  ✓ wrote LOGBOOK.md     hotspots · do-not-retry · suppression ledger
  ✓ wrote events.jsonl   structured history events
  ✓ wrote JOURNEY.md     the repo's story
```

## What it produces

| Path | Purpose |
|---|---|
| `LOGBOOK.md` | Bounded history brief for agents: hotspots, do-not-retry reverts, suppressions, weakened assertions, and fragile areas |
| `events.jsonl` | Structured deterministic history events for tools and queries |
| `JOURNEY.md` | Human-readable narrative of the repository's history |
| `.logbook/drafts/` | Local, gitignored, inert decision proposals; never trusted or surfaced by `check` |
| `.logbook/leads/` | Committed policy-published machine leads; lower authority and always labeled as such |
| `.logbook/decisions/` | Committed decisions that have an exact matching human review record |
| `.logbook/reviews/` | Committed reviewer provenance and byte bindings for promotions/rejections |

One card per file makes the reviewed bytes visible in a normal Git diff and
lets Git provide authority history, merge behavior, and rollback.

## Quick start

Analyze and query history:

```bash
npx @promptwheel/logbook
npx @promptwheel/logbook context --file src/cache.ts --revert
npx @promptwheel/logbook audit
npx @promptwheel/logbook doctor
```

When an agent investigates a prior decision during real work, it can preserve
the result as an inert draft:

```bash
logbook annotate-draft <commit> "why this approach was rejected" \
  --span "exact bytes introduced or removed" \
  --side diff \
  --evidence-file src/cache.ts \
  --by codex

logbook pending
```

`annotate` is a compatibility alias for `annotate-draft`. A message citation
uses `--side message` and no `--evidence-file`. A claim supplied directly by a
human may omit a span, but an agent should cite evidence whenever its claim is
derived from Git. An absent or unverifiable quote is rejected rather than
guessed.

A person reviews the complete draft and promotes the exact card:

```bash
logbook accept-draft <full-card-id> --by matthew
git commit .logbook/ -m "logbook: accept cache decision"
```

`accept` is a compatibility alias for `accept-draft`. The full card ID and an
explicit reviewer attribution are required. The commit or reviewed PR—not the
`--by` string—is the authority boundary.

At diff time:

```bash
logbook check --diff
logbook check --diff --base origin/main --head HEAD
```

The range form reads trust state from the pinned base commit, so a PR cannot
make its own newly added card authoritative. Local mode trusts the captured
`HEAD`. Output is bounded to 20 rows / 8 KiB and provides an opaque `NEXT`
cursor when more candidates remain. A page with `NEXT` exits nonzero because
later cards have not been checked yet; only `END complete` can finish cleanly.

## Authority tiers

Logbook never converts model confidence into authority.

- **Draft** — local and inert. It cannot surface in `check --diff`.
- **Policy-published lead** — machine-authored, grounded and admitted by a
  repository-owned policy. It surfaces as a conspicuous lead, not as a human
  decision.
- **Human-reviewed decision** — the card bytes have a matching committed review
  record. It is authoritative only within its explicit path scopes and trusted
  Git boundary.

The same card ID stays the handle as a lead is accepted. A human can accept it
unchanged, correct the claim while accepting, or reject it:

```bash
logbook accept-lead <full-card-id> --by matthew
logbook accept-lead <full-card-id> --by matthew --claim "corrected claim"
logbook reject-lead <full-card-id> --by matthew
git commit .logbook/ -m "logbook: review machine leads"
```

`logbook outcomes` reports the Git-observable funnel for machine leads: kept
as-is, edited, pending, or vanished. It is not semantic claim precision and it
refuses to report a clean result when the relevant history is unreadable.

## Automatic publication

Automatic mode is opt-in and publishes only lower-authority leads. It never
creates a human-reviewed decision.

Commit a strict policy to the trusted branch:

```toml
# .logbook/policy.toml
enabled = true
allowed_scopes = ["src/"]
protected_paths = ["src/auth/", "src/security/"]
max_cards_per_run = 10
max_total_cards = 500
```

Then pass a bounded JSON array on stdin or with `--candidates`:

```bash
logbook publish --candidates candidates.json
git add .logbook/leads/
git commit -m "logbook: publish decision leads"
```

Publication requires a single Git worktree. Linked worktrees cannot share
uncommitted plane counts safely, so the command fails closed in that topology;
run automatic publication from a single-worktree checkout or CI clone. The
trusted-ref reader also rejects a merged lead plane above `max_total_cards`.

Each candidate contains `sha`, `claim`, `span`, `side`, `evidenceFile` when the
side is `diff`, and `scopes`. Publication independently reloads the committed
policy, checks source ancestry, mechanically grounds the quote against raw Git
objects, enforces allowed/protected scopes and quotas, and honors
`.logbook/AUTOMATION_DISABLED` as an immediate kill switch.

Mechanical grounding proves only that the quote occurs in the named commit
message, or was introduced/removed in the named changed file. It does **not** prove that the generated
interpretation is correct, that the evidence caused the change, or that the
decision still applies. That is why automatic cards remain leads until a human
reviews them.

## Trust model

The trusted Git ref is the authority plane. In a team repository, use normal
branch protection and code review for `.logbook/decisions/`,
`.logbook/reviews/`, `.logbook/leads/`, and `.logbook/policy.toml`. `--by` is
auditable attribution, not proof of identity. In an unprotected solo repo, the
trust boundary is simply whoever can commit to that ref.

At read time Logbook pins refs to immutable commits, validates canonical card
and review bytes, checks path scopes and source ancestry, and re-grounds machine
evidence. Missing or malformed trust data is *unmeasurable*, never silently
reported as clean. Drafts cannot confer authority.

This model protects against malformed repository input and accidental or
unreviewed promotion. It does not make a hostile committer trustworthy; protect
the branch that supplies authority.

## Command reference

```text
logbook init [path]
logbook [path]
logbook journey [path]
logbook audit [path]
logbook doctor [path]
logbook query [path] [filters]
logbook context [path] [filters] [--cursor TOKEN]

logbook annotate|annotate-draft SHA "WHY" [evidence options] [--by WHO]
logbook pending [path]
logbook refine [path] [--limit N]
logbook accept|accept-draft CARDID --by WHO [--file P ...] [--dir P/]

logbook publish [--candidates FILE]
logbook accept-lead CARDID --by WHO [--claim "corrected text"]
logbook reject-lead CARDID --by WHO
logbook outcomes [path]
logbook check --diff [--base SHA --head SHA] [--cursor TOKEN]
                     [--metrics-out PATH]
```

`refine` is a deterministic worklist of unannotated notable history. It does
not generate claims: the agent must inspect each commit and cite what it found.

`--metrics-out` writes aggregate check counts only; it does not include repo
names, paths, SHAs, prose, or authors, and nothing phones home.

## History queries and context economics

`context` preserves filtered `query` order but emits pages of at most 20 events
and 8 KiB. Repeat identical filters with each `NEXT` cursor until `END
complete`. A cursor is bound to the repository HEAD, filters, analysis window,
and ordered event set.

The history scan is cached in bounded windows. On a measured 20k-commit repo:
43s cold, 0.4s with a prior run on disk, and 4ms on repeat calls in an MCP
session. `LOGBOOK_NO_CACHE=1` forces a rebuild; `LOGBOOK_WINDOW=N` tunes the
window.

In a random 400-repo sample of the top 2,500 GitHub repositories, the median
`LOGBOOK.md` was about 1,000 estimated tokens while the median full `git log`
was 82× larger. See [context economics](docs/context-economics.md) and the
[bounded context format](docs/context-format.md).

## Evidence status

Logbook's deterministic history inventory is useful, but reviewed decision
cards remain an instrumented alpha. Existing experiments do not establish the
prevalence of decision conflicts, durable business value, or how often teams
will review cards. The Git-observable funnel begins measuring review behavior;
prevalence and downstream task impact require longitudinal usage and fresh
benchmarks.

Likewise, this release is not a complete accepted-decision lifecycle manager.
It supports drafting, initial promotion, machine-lead correction/rejection,
and diff-time surfacing. It does not yet provide first-class CLI commands to
revise or retire an already accepted decision. Do not hand-edit an accepted
card and expect it to remain authoritative: its review binding will fail until
a future reviewed lifecycle operation replaces it.

Selected benchmark evidence and its limits are documented in
[wrong-work-benchmark.md](docs/wrong-work-benchmark.md) and
[does-it-change-agent-behavior.md](docs/does-it-change-agent-behavior.md).

## Honest scope

- Findings are leads, not verdicts. A suppression means “look here,” not
  misconduct.
- Detection is deterministic regex over commit subjects and diffs. It misses
  history erased by squash/rebase and anything never committed.
- Shallow clones starve historical analysis; fetch the missing history before
  treating absence as evidence.
- Code maps explain where code is. Logbook focuses on what happened over time
  and what a reviewed team decision says about a touched scope.

## The logbook records; the referee judges

Logbook tells you what history and reviewed decisions say. [promptwheel](https://github.com/promptwheel-ai/promptwheel)
is the referee that judges whether today's claimed improvement came from the
code rather than moving the goalposts.

MIT.
