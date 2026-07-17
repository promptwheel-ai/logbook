# logbook

[![ci](https://github.com/promptwheel-ai/logbook/actions/workflows/ci.yml/badge.svg)](https://github.com/promptwheel-ai/logbook/actions/workflows/ci.yml) [![npm latest](https://img.shields.io/npm/v/%40promptwheel%2Flogbook?label=npm%20latest)](https://www.npmjs.com/package/@promptwheel/logbook) [![npm next](https://img.shields.io/npm/v/%40promptwheel%2Flogbook/next?label=npm%20next)](https://www.npmjs.com/package/@promptwheel/logbook)

> **0.9 instrumented alpha.** The deterministic history layer is ready for
> use. The opt-in temporal decision layer has a hardened trust boundary, but
> review adoption, downstream task utility, and token ROI are still being
> measured. Version `0.9.1` is the corrective release candidate for npm's
> `next` channel: immediate unreviewed enrichment is restored, while the
> reviewed decision workflow remains optional.

**Git history is large. When coding agents do not inspect it, they can
re-propose approaches a repository already rejected.**

Logbook turns a repository's history into two complementary things:

- a deterministic recall layer: hotspots, reverted approaches, suppressions,
  assertion weakening, and bounded history queries; and
- an opt-in temporal decision layer: reviewable decision cards attached to code
  paths and surfaced when a later diff touches those paths.

Everything runs locally. The CLI has zero npm dependencies, reads raw Git
objects for evidence checks, and never sends repository data anywhere.
Node.js 18 or newer is required.

```bash
npx -y @promptwheel/logbook@0.9.1 init
```

`init` analyzes the repo, writes the history artifacts, and installs a compact
workflow in `AGENTS.md`, `CLAUDE.md`, or `.cursorrules`.

```text
  1,326 commits · 322 files · 7.3 years · 354 authors

  ✓ wrote LOGBOOK.md     hotspots · do-not-retry · suppression ledger
  ✓ wrote events.jsonl   structured history events
  ✓ wrote JOURNEY.md     the repo's story
```

The examples below use `logbook` as the binary name. Run them through the exact
package above, or install `@promptwheel/logbook@0.9.1` locally or globally.

## What it stores

`init` creates the deterministic history artifacts:

| Path | Purpose |
|---|---|
| `LOGBOOK.md` | Bounded history brief for agents: hotspots, do-not-retry reverts, suppressions, weakened assertions, and fragile areas |
| `events.jsonl` | Structured deterministic history events for tools and queries |
| `JOURNEY.md` | Human-readable narrative of the repository's history |

`annotate` separately creates `annotations.jsonl`: durable machine-authored
notes shown in the digest as explicitly unreviewed leads, never consumed by
`check --diff`. Commit that file to share the notes with the team, or add it to
`.gitignore` to keep them local to one checkout.

The optional decision workflow adds state only as cards are drafted or
published. Cold start does not bulk-generate decisions or a review backlog.

| Path | Purpose |
|---|---|
| `.logbook/drafts/` | Local, gitignored, inert decision proposals; never trusted or surfaced by `check` |
| `.logbook/leads/` | Committed policy-published machine leads; lower authority and always labeled as such |
| `.logbook/decisions/` | Committed decisions that have an exact matching human review record |
| `.logbook/reviews/` | Committed reviewer provenance and byte bindings for promotions/rejections |

One card per file makes the reviewed bytes visible in a normal Git diff and
lets Git provide review history, merge behavior, and rollback. A protected
trusted ref supplies team authority.

## Quick start

Analyze and query history:

```bash
logbook
logbook context --file src/cache.ts --revert
logbook audit
logbook doctor
```

When an agent investigates why a prior change happened during real work, it can
preserve the result immediately—no prompt or human gate:

```bash
logbook annotate <commit> "why this approach was rejected" --by codex
```

The note is durably appended to `annotations.jsonl` and appears in
`LOGBOOK.md` before the command exits. It is always labeled machine-authored
and unreviewed, is bounded in the startup digest, and can never become a
reviewed decision or enter `check --diff`. An optional exact quote can be
attached with `--span`, `--side`, and (for diff evidence) `--evidence-file`.

When a particular finding needs human authority, use the separate reviewed
card workflow:

```bash
logbook annotate-draft <commit> "why this approach was rejected" \
  --span "exact bytes introduced or removed" \
  --side diff \
  --evidence-file src/cache.ts \
  --by codex

logbook pending
```

`annotate-draft` is explicit: it creates an inert local card and returns a full
card ID. A message citation uses `--side message` and no `--evidence-file`.
An absent or unverifiable quote is rejected rather than guessed.

A person reviews the complete draft and promotes the exact card:

```bash
logbook accept-draft <full-card-id> --by matthew
git commit .logbook/ -m "logbook: accept cache decision"
```

`accept` is a compatibility alias for `accept-draft`. The full card ID and an
explicit reviewer attribution are required. The trusted ref is the authority
boundary. A protected, reviewed PR is the recommended team workflow; the
`--by` string alone proves no identity.

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

- **Unreviewed digest note** — immediate machine-authored recall in
  `LOGBOOK.md`. It is outside the decision planes and never enters `check`.
- **Draft** — local and inert. It cannot surface in `check --diff`.
- **Policy-published lead** — machine-authored, grounded and admitted by a
  repository-owned policy. It surfaces as a conspicuous lead, not as a human
  decision.
- **Human-reviewed decision** — the card bytes have a matching committed review
  record on the trusted ref. Logbook treats it as reviewed within its explicit
  path scopes; review does not prove semantic truth or continued applicability.

The same card ID stays the handle as a lead is accepted. A human can accept it
unchanged, correct the claim while accepting, or reject it:

```bash
logbook accept-lead <full-card-id> --by matthew
logbook accept-lead <full-card-id> --by matthew --claim "corrected claim"
logbook reject-lead <full-card-id> --by matthew
git commit .logbook/ -m "logbook: review machine leads"
```

`logbook outcomes` reports the Git-observable funnel for machine leads:
accepted as-is, accepted with edits, explicitly rejected, pending, or vanished
without review. The last state is unmeasurable, not a rejection. The report is
not semantic claim precision and refuses to report a clean result when the
relevant history is unreadable.

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

```json
[
  {
    "sha": "0123456789abcdef0123456789abcdef01234567",
    "claim": "The bounded cache replaced unbounded retention after memory growth",
    "span": "new LRUCache({ max: 500 })",
    "side": "diff",
    "evidenceFile": "src/cache.ts",
    "scopes": ["src/cache.ts"],
    "by": "codex"
  }
]
```

```bash
logbook publish --candidates candidates.json
git add .logbook/leads/
git commit -m "logbook: publish decision leads"
```

Publication requires a single Git worktree. Linked worktrees cannot share
uncommitted plane counts safely, so the command fails closed in that topology;
run automatic publication from a single-worktree checkout or CI clone. The
trusted-ref reader also rejects a merged lead plane above `max_total_cards`.

Logbook does not call a model to create candidates. An agent or external tool
supplies `sha`, `claim`, `span`, `side`, `evidenceFile` when the side is `diff`,
and `scopes`; `by` is optional attribution. Publication independently reloads
the committed policy, checks source ancestry, mechanically grounds the quote
against raw Git objects, enforces allowed/protected scopes and quotas, and
honors `.logbook/AUTOMATION_DISABLED` as an immediate kill switch.

Mechanical grounding proves only that the quote occurs in the named commit
message, or was introduced/removed in the named changed file. It does **not** prove that the generated
interpretation is correct, that the evidence caused the change, or that the
decision still applies. That is why automatic cards remain leads until a human
reviews them.

## Why the trust model is strict

Decision memory can steer future agents. If generated rationale is mistaken,
repeated model agreement can make one correlated interpretation look like
independent confirmation—a self-reinforcing hallucination with repository
authority attached.

Logbook therefore separates three claims: source bytes exist, a machine
interpreted them, and a trusted ref reviewed the exact resulting card.
Grounding establishes only the first. Review establishes that the repository's
process accepted those bytes, not that the interpretation is eternally true.
Repeated machine confirmations never promote authority.

The trusted Git ref is the authority plane. In a team repository, use normal
branch protection and code review for `.logbook/decisions/`,
`.logbook/reviews/`, `.logbook/leads/`, and `.logbook/policy.toml`. `--by` is
auditable attribution, not proof of identity. In an unprotected solo repo, the
trust boundary is simply whoever can commit to that ref.

At read time Logbook pins refs to immutable commits, validates canonical card
and review bytes, checks path scopes and source ancestry, and re-grounds machine
evidence. Missing or malformed trust data is *unmeasurable*, never silently
reported as clean. Drafts cannot confer authority.

The model is designed and regression-tested to fail closed on malformed or
unverifiable trust state, and to prevent drafts or leads from being displayed
as human-reviewed without an exact matching review record. It does not make a
hostile committer trustworthy; protect the branch that supplies authority.

## Open Knowledge Format export

Logbook can project the reviewed decision plane into an
[Open Knowledge Format (OKF) 0.1](docs/okf-export.md) Markdown bundle:

```bash
logbook export . --format okf --out ./logbook-okf --ref HEAD
```

The export is deterministic for one pinned Git commit and includes readable
decision pages, a neutral manifest, exact native card/review receipts, and a
file-hash receipt. It exports byte-bound human-reviewed decisions by default;
machine leads, local drafts, and unreviewed digest notes are not silently
promoted into the bundle.

OKF is an interoperability view, not another trust plane. Canonical authority
stays under `.logbook/`; editing or committing an exported Markdown page cannot
create, accept, or change a Logbook decision. The first exporter is deliberately
one-way and refuses to overwrite an existing output directory.

## Upgrading from 0.8 or 0.9.0

Existing `annotations.jsonl` rows remain unreviewed digest notes and render
again; `init` does not turn them into a review backlog. Existing 0.9.0 drafts
remain local and inert. In 0.9.1, `annotate` once again means immediate digest
enrichment. A 0.9.0 script that expects `annotate` to return a card ID must use
the explicit `annotate-draft` command instead. If 0.8 wrote annotations to a
custom `--out` directory, move that `annotations.jsonl` to the repository root;
0.9.1 intentionally keeps the note store at one unambiguous location.

## Command reference

```text
logbook init [path]
logbook [path]
logbook journey [path]
logbook audit [path]
logbook doctor [path]
logbook query [path] [filters]
logbook context [path] [filters] [--cursor TOKEN]

logbook annotate SHA "WHY" [optional evidence] [--by WHO]
logbook annotate-draft SHA "WHY" [evidence options] [--by WHO]
logbook pending [path]
logbook refine [path] [--limit N]
logbook accept|accept-draft CARDID --by WHO [--file P ...] [--dir P/]

logbook publish [--candidates FILE]
logbook accept-lead CARDID --by WHO [--claim "corrected text"]
logbook reject-lead CARDID --by WHO
logbook outcomes [path]
logbook check --diff [--base SHA --head SHA] [--cursor TOKEN]
                     [--metrics-out PATH]
logbook export [path] --format okf --out NEW_DIR [--ref REF]
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

The earlier enrichment benchmark directionally favored immediate annotations:
the annotated arm recovered the planted failure cause while the unannotated arm
guessed, but only 2 of 8 tasks were spot-checked, so this is not economic proof.
The deterministic history inventory also showed value on selected history-dense
planning tasks. A later sealed held-out screen found no advantage over a strong
raw-Git instruction because task-facing retrieval delivered none of the sealed
lineage items. The new diff-time decision path addresses that delivery failure,
but has not yet been tested on a fresh held-out sample.

Reviewed decision cards therefore remain an instrumented alpha. Existing
experiments do not establish ordinary-task prevalence, durable business value,
or how often teams will review cards. `logbook outcomes` measures only the
Git-observable review funnel. Review time, warning relevance, misleading claims,
changed plans, avoided wrong work, and amortized token/time cost require a
dogfood harness and human labels; nothing is inferred or sent as telemetry.

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
