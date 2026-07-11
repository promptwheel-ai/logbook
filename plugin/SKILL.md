---
name: logbook
description: Turn a repo's git history into memory an agent can use. Writes LOGBOOK.md (hotspots, do-not-retry reverts, suppression ledger, fragile areas), events.jsonl (structured events), JOURNEY.md (the repo's story). Use when onboarding to an unfamiliar repo, before proposing large changes, or when asked what happened in a codebase. Structure maps show WHERE code is; the logbook shows WHAT HAPPENED and why. The logbook records; the referee (promptwheel gate) judges.
---

# Logbook

```bash
npx @promptwheel/logbook              # analyze current repo → 3 files
npx @promptwheel/logbook journey      # the story, in color (writes nothing)
npx @promptwheel/logbook --json       # events to stdout (writes nothing)
```

Read-only. Zero deps. `-n N` caps commits; `--since/--until` for era scoping.

After running: read LOGBOOK.md and relay "What a fresh session should know"
plus the 2-3 most notable findings. TRIAGE, don't parrot: the logbook is a
recall layer — you are the precision layer. Cross-reference findings against
the current task, and verify any lead you act on with `git show <sha>` before
asserting what happened. Findings are leads, not verdicts — a suppression
event means "a human should look here," not misconduct. If the repo is
shallow, offer `git fetch --unshallow` first.
