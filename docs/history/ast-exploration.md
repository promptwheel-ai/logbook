# AST exploration (2026-07-10)

A design note from early development, kept for the record. It asks whether
upgrading detection from regex to AST parsing adds real capability, and what
to adopt when.

## The three options

1. **Full AST via tree-sitter-class parsers**: not adopted for the core. It
   would end the zero-dependency single-file design (the thing that makes
   `npx` cold trust possible), add per-language grammars, and the precision
   gain is invisible in ordinary use. If ever shipped, it would be an opt-in
   enrichment pack that deepens events.jsonl; the core stays single-file.
2. **A larger AST+dataflow pattern engine** from earlier work: the real
   deep-analysis asset. If it ships, it ships as an opt-in pack that
   enriches events.jsonl, never into the zero-dep core.
3. **AST-grade checks that don't need an AST**: adopted. The canonical
   "regex can't see this" case is semantic assertion weakening:
   `expect(x).toEqual(y)` → `expect(x).toBeTruthy()`. Same line count,
   assertion gutted. But it IS visible to paired diff analysis: a STRONG
   assertion form removed and a WEAK form added in the same file's hunks is
   a downgrade. Deterministic, zero-dep, and small enough to add in one pass.

## The strength table (v1)

STRONG (exact/behavioral): toStrictEqual, toEqual, toBe(, toMatchObject,
toThrow(<arg>), assertEqual, assertIs, assertRaises(<specific>), == literal
comparisons in asserts.
WEAK (existence/truthiness): toBeTruthy, toBeFalsy, toBeDefined,
toBeUndefined, not.toThrow, toHaveBeenCalled (bare), assertTrue,
assertIsNotNone, bare `assert x`.

Downgrade per file-hunk = min(strong_removed, weak_added). Conservative by
construction: requires both sides in the same commit and file class
(src/test/config only, per-file attribution from extractor v2).

## Python stdlib-AST (v0.3 candidate, not now)

Python ships `ast` in the stdlib. An opt-in deep mode could shell out to
python3 (as the tool already shells out to git) and parse test files pre/post
commit for true semantic diffs, with no npm deps. Cost: per-commit `git show`
pairs plus parsing is 10-50x slower and needs its own caps and a corpus pass.
Worth exploring only if downgrade detection proves there is demand.

## Verdict

Regex+heuristics stays the core. Downgrade detection was adopted (it is the
strongest "not just grep" proof and a real capability). AST proper enters as
packs, by demand, never into the zero-dep core.

## Postscript: where the exploration ended (2026-07-11)

The real finding, one level above "regex vs AST": **git itself is the
tool.** Git is already a content-addressed database with a C-speed query
engine - log, grep, blame, pickaxe (-S), numstat, diff. The logbook is thin
layers over that substrate:

1. **git plumbing = the database** (log/numstat/-p for events; grep for
   present-state; blame for exact line provenance; pickaxe held for deep joins)
2. **lexical classifiers = the distiller** (the regex tables; 93% calibrated)
3. **joins = the product** (dates × presence × files: the audit, the ledger,
   per-file history)
4. **parsers = the ruler** (AST's proven job: calibrating the classifiers)
5. **the reading agent = the judge** (triage, verification, intent)

Each layer stays replaceable without touching the others. Versatility didn't
come from a smarter parser; it came from asking git questions it could
already answer.
