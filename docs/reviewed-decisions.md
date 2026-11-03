# Reviewed decisions (experimental, opt-in)

Logbook's deterministic history layer (`LOGBOOK.md`, `events.jsonl`,
`context`, `audit`, `annotate`) needs no setup beyond `init`. This document
covers the separate, opt-in temporal decision layer: reviewable decision cards
attached to code paths and surfaced when a later diff touches those paths.

The layer is an instrumented alpha. Its trust boundary is hardened and
regression-tested; its review adoption and token return are still being
measured. Nothing here runs unless you call these commands, and cold start
never bulk-generates decisions or a review backlog.

## Storage planes

The decision workflow adds state only as cards are drafted or published.

| Path | Purpose |
|---|---|
| `.logbook/drafts/` | Local, gitignored, inert decision proposals; never trusted or surfaced by `check` |
| `.logbook/leads/` | Committed policy-published machine leads; lower authority and always labeled as such |
| `.logbook/decisions/` | Committed decisions that have an exact matching human review record |
| `.logbook/reviews/` | Committed reviewer provenance and byte bindings for promotions/rejections |

One card per file makes the reviewed bytes visible in a normal Git diff and
lets Git provide review history, merge behavior, and rollback. A protected
trusted ref supplies team authority.

## Drafting and promoting a card

When a particular finding needs human authority (an ordinary `annotate` note
does not), use the reviewed card workflow:

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

## Diff-time check

```bash
logbook check --diff
logbook check --diff --base origin/main --head HEAD
```

The range form reads trust state from the pinned base commit, so a PR cannot
make its own newly added card authoritative. Local mode trusts the captured
`HEAD`. Output is bounded to 20 rows / 8 KiB and provides an opaque `NEXT`
cursor when more candidates remain. A page with `NEXT` exits nonzero because
later cards have not been checked yet; only `END complete` can finish cleanly.

Running the check is opt-in. The `## Repo memory` block that `init` writes
does not mention it, the agent skill does not require it, and no other
command refuses to finish because it was skipped. A team that has adopted
reviewed cards typically runs the range form in CI on each pull request.

## Authority tiers

Logbook never converts model confidence into authority.

- **Unreviewed digest note**: immediate machine-authored recall in
  `LOGBOOK.md`. It is outside the decision planes and never enters `check`.
- **Draft**: local and inert. It cannot surface in `check --diff`.
- **Policy-published lead**: machine-authored, grounded and admitted by a
  repository-owned policy. It surfaces as a conspicuous lead, not as a human
  decision.
- **Human-reviewed decision**: the card bytes have a matching committed review
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
message, or was introduced/removed in the named changed file. It does **not**
prove that the generated interpretation is correct, that the evidence caused
the change, or that the decision still applies. That is why automatic cards
remain leads until a human reviews them.

## Why the trust model is strict

Decision memory can steer future agents. If generated rationale is mistaken,
repeated model agreement can make one correlated interpretation look like
independent confirmation, a self-reinforcing hallucination with repository
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

Logbook can project the reviewed decision plane into an experimental
[Open Knowledge Format (OKF) 0.1](okf-export.md) Markdown bundle:

```bash
logbook export . --format okf --out ./logbook-okf --ref HEAD
```

The export is deterministic for one pinned Git commit and includes readable
decision pages, a neutral manifest, exact native card/review receipts, and a
file-hash receipt. It exports byte-bound human-reviewed decisions by default;
machine leads, local drafts, and unreviewed digest notes are not silently
promoted into the bundle. OKF is an interoperability view, not another trust
plane: canonical authority stays under `.logbook/`, and the first exporter is
deliberately one-way.

## Evidence status and lifecycle limits

The earlier enrichment benchmark directionally favored immediate annotations:
the annotated arm recovered the planted failure cause while the unannotated arm
guessed, but only 2 of 8 tasks were spot-checked, so this is not economic proof.
A later sealed held-out screen found no advantage over a strong raw-Git
instruction because task-facing retrieval delivered none of the sealed lineage
items. The diff-time decision path addresses that delivery failure, but has
not yet been tested on a fresh held-out sample.

Reviewed decision cards therefore remain an instrumented alpha. Existing
experiments do not establish ordinary-task prevalence, durable business value,
or how often teams will review cards. `logbook outcomes` measures only the
Git-observable review funnel. Review time, warning relevance, misleading claims,
changed plans, avoided wrong work, and amortized token/time cost require a
dogfood harness and human labels; nothing is inferred or sent as telemetry.

This is not a complete accepted-decision lifecycle manager. It supports
drafting, initial promotion, machine-lead correction/rejection, and diff-time
surfacing. It does not yet provide first-class CLI commands to revise or retire
an already accepted decision. Do not hand-edit an accepted card and expect it
to remain authoritative: its review binding will fail until a future reviewed
lifecycle operation replaces it.
