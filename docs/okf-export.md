# Open Knowledge Format export

Logbook exports its reviewed decision plane as a deterministic Markdown
projection compatible with the
[Open Knowledge Format 0.1 draft](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md).
The exporter pins that exact specification revision so a future draft cannot
silently change the meaning of an existing bundle.

This first interoperability surface is available through the CLI and exported
JavaScript functions only. It intentionally adds no MCP tool, import path, or
write-back path.

## Export

```bash
logbook export . --format okf --out ./logbook-okf --ref HEAD
```

For repeated snapshots, choose a fresh commit-suffixed directory, for example
`./logbook-okf-$(git rev-parse --short HEAD)`. Safe in-place refresh is
intentionally deferred.

`--ref` may name a branch, tag, or commit. Logbook resolves it once to an
immutable commit and reads all authority records from that commit with raw Git
object operations. Dirty working-tree edits do not enter the projection.

`--out` must name a new directory whose parent already exists and does not
traverse a caller-controlled symlink. Stable operating-system aliases for the
temporary directory (such as macOS `/tmp` → `/private/tmp`) are accepted. The
exporter refuses the repository root, `.git`, `.logbook`, unsafe paths, and an
existing target. It assembles a complete generation in a private sibling
directory and installs it atomically.

## Bundle

```text
index.md
decisions/
  index.md
  <card-id>.md
receipts/
  cards/<card-id>.json
  reviews/<card-id>.json
  neutral-manifest.json
  projection-receipt.json
```

- `index.md` declares `okf_version: "0.1"` and links to the decision index.
- Each decision page has OKF YAML frontmatter and readable Markdown.
- `neutral-manifest.json` carries the complete machine-readable projection
  without relying on Markdown parsing.
- `cards/` and `reviews/` contain the exact canonical native bytes that were
  projected.
- `projection-receipt.json` binds the trusted commit, exporter/schema version,
  pinned OKF specification, neutral manifest, and the bytes and SHA-256 digest
  of every other generated file. The receipt itself is identified by the
  full projection digest printed by the command. There is not yet a standalone
  bundle-verifier command; these files are portable audit material.

The same native trust state and exporter version produce byte-identical output
whether the input is addressed as `HEAD`, a tag, or its commit ID.

## Authority boundary

The projection is never imported. `.logbook/decisions/` and
`.logbook/reviews/` on the trusted Git ref remain the only authority source.
Editing a generated page, its frontmatter, or a receipt cannot affect
`logbook check --diff`.

The initial exporter includes only decisions with an exact, accepted or edited,
byte-binding human review. It intentionally omits:

- policy-published machine leads;
- local inert drafts;
- unreviewed `annotations.jsonl` digest notes.

The bundle contains exact claims, evidence spans, scopes, proposer names, and
reviewer names. Treat it as potentially sensitive repository data and share it
under the same access policy as the source repository.

A reviewed decision can still become stale. At export time Logbook rechecks
source ancestry and mechanically re-grounds machine evidence. If either can no
longer be verified, the historical reviewed record remains visible but the page
sets `x-logbook-current-authoritative: false`, records the reason, and displays
a re-review warning. Human attestations are labeled as attestations and never
presented as mechanically grounded evidence.

Mechanical grounding establishes only that quoted bytes occur in a commit
message or were introduced/removed in a changed file. It does not prove the
generated causal interpretation is true, caused the change, or still applies.
Human review proves that the repository process accepted the exact card bytes,
not eternal semantic correctness.

## Why export instead of adopt OKF as storage

OKF is intentionally a permissive knowledge interchange format. Logbook's
native files additionally enforce exact card/review byte binding, authority
tiers, source ancestry, evidence grounding, and fail-closed reads. Replacing the
native trust plane with Markdown would discard those invariants.

The one-way projection gives other OKF-compatible tools readable, portable
knowledge without creating a second writable authority system. An import path,
lead export, or wiki write-back should be added only with an explicit conflict
and authority model; none exists in this version.
