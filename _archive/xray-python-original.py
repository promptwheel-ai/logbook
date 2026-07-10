#!/usr/bin/env python3
"""X-ray v0.5: distill a git repo's history into an agent-consumable digest.

Each commit becomes a structured event: shape (file classes), behavioral delta
(assertions/suppressions), intent (message framing), authorship. Digest
surfaces what a fresh agent session needs: hotspots, reverts, suppression
history, test-weakening events, fragile areas, abandoned approaches.

Usage: xray.py REPO [-n MAX] [--since DATE] [--until DATE] [--json] > out
  --json emits JSONL events (data layer); default emits markdown (agent layer).
Classifier lineage: wild-rate-study scan3 (calibrated 12/12) + study lessons.
"""
import re, subprocess, sys, json, argparse
from collections import Counter, defaultdict

ap = argparse.ArgumentParser()
ap.add_argument("repo")
ap.add_argument("-n", "--max", type=int, default=500)
ap.add_argument("--since", default=None)
ap.add_argument("--until", default=None)
ap.add_argument("--json", action="store_true")
ap.add_argument("--journey", action="store_true")
A = ap.parse_args()
ERA = ([f"--since={A.since}"] if A.since else []) + ([f"--until={A.until}"] if A.until else [])

TEST_PAT = re.compile(r"(^|/)(tests?|__tests__|spec|specs|fixtures?|snapshots?|__snapshots__|golden)/|\.(test|spec)\.[jt]sx?$|_test\.(go|py|rb)$|conftest\.py$|(^|/)(jest|vitest|playwright|cypress|karma)\.config", re.I)
CONFIG_PAT = re.compile(r"(^|/)(\.eslintrc|eslint\.config|tsconfig[^/]*\.json|pytest\.ini|setup\.cfg|tox\.ini|\.rubocop|\.github/|Dockerfile|docker-compose|vercel\.json|package\.json|.*\.ya?ml)$", re.I)
DOC_PAT = re.compile(r"\.(md|txt|rst|adoc)$|^LICENSE|^docs/", re.I)
GEN_PAT = re.compile(r"node_modules/|\.map$|\.lock$|lock\.json$|\.gen\.|generated|dist/|build/|vendor/", re.I)
SUPPRESS_PAT = re.compile(r"@ts-nocheck|@ts-ignore|eslint-disable|# *noqa|# *type: *ignore|\bit\.skip\b|\btest\.skip\b|\bxit\(|\bxdescribe\(|describe\.skip|@pytest\.mark\.skip|@unittest\.skip|t\.Skip\(|except[^:]*: *pass")
ASSERT_PAT = re.compile(r"assert|expect\(|\.toBe|\.toEqual|t\.Error|t\.Fatal")
REVERT_PAT = re.compile(r"revert|rollback|undo|back out", re.I)
FIX_PAT = re.compile(r"\bfix|resolve|repair|bug\b", re.I)

def git(*args):
    return subprocess.run(["git", "-C", A.repo] + list(args), capture_output=True, text=True, timeout=180).stdout

def classify_file(f):
    if GEN_PAT.search(f): return "gen"
    if DOC_PAT.search(f): return "doc"
    if TEST_PAT.search(f): return "test"
    if CONFIG_PAT.search(f): return "config"
    return "src"

# --- collect commit events ---
log = git("log", f"-{A.max}", "--no-merges", "--date=short", *ERA,
          "--pretty=%x1e%h%x1f%ad%x1f%an%x1f%s", "--numstat")
events = []
for chunk in log.split("\x1e"):
    if not chunk.strip(): continue
    head, _, body = chunk.partition("\n")
    parts = head.split("\x1f")
    if len(parts) != 4: continue
    sha, date, author, subject = parts
    files, adds, dels = defaultdict(int), 0, 0
    for line in body.splitlines():
        m = re.match(r"(\d+|-)\t(\d+|-)\t(.+)", line)
        if not m: continue
        a, d, f = m.groups()
        files[classify_file(f)] += 1
        if a != "-": adds += int(a)
        if d != "-": dels += int(d)
    events.append({"sha": sha, "date": date, "author": author, "subject": subject[:110],
                   "shape": dict(files), "adds": adds, "dels": dels,
                   "revert": bool(REVERT_PAT.search(subject)), "fix": bool(FIX_PAT.search(subject)),
                   "suppressions": [], "del_asserts": 0, "add_asserts": 0})


if A.journey:
    from datetime import datetime as _dt
    ev = list(reversed(events))  # oldest first
    _fl = subprocess.run(["git","-C",A.repo,"log","--reverse","--date=short",
        "--pretty=%ad%x1f%f"],capture_output=True,text=True).stdout.splitlines()
    first = {}
    if _fl:
        _p = _fl[0].split("\x1f")
        first = {"date": _p[0], "subject": _p[1] if len(_p)>1 else "..."}
    name = A.repo.rstrip("/").split("/")[-1]
    n = len(ev)
    # beats
    thresh = next((e for e in ev if e["shape"].get("test")), None)
    mentor = None
    for e in ev:
        if re.search(r"claude\.md|\.claude|cursorrules|agents?\.md", e["subject"], re.I):
            mentor = e; break
    abyss = max(ev, key=lambda e: e["dels"]) if ev else None
    reverts = [e for e in ev if e["revert"]]
    silences = [e for e in ev if re.search(r"\bskip|disable.*test|noqa|ts-nocheck|quarantine", e["subject"], re.I)]
    refix = Counter()
    for e in ev:
        if e["fix"]:
            k = re.sub(r"[^a-z ]","",e["subject"].lower())[:40].strip()
            if len(k) > 14: refix[k] += 1
    trials = [(k,c) for k,c in refix.most_common(6) if c >= 2]
    touches = Counter()
    for e in ev:
        pass
    # hotspot via name-only pass (fast)
    for line in git("log", f"-{A.max}", "--no-merges", "--name-only", *ERA, "--pretty=%x1e").split("\x1e"):
        for f in set(l for l in line.strip().splitlines() if l and not GEN_PAT.search(l) and classify_file(l)=="src"):
            touches[f] += 1
    hot = touches.most_common(1)
    # longest winter
    dates = [_dt.strptime(e["date"], "%Y-%m-%d") for e in ev]
    winter = (0, None, None)
    for i in range(1, len(dates)):
        gap = (dates[i]-dates[i-1]).days
        if gap > winter[0]: winter = (gap, ev[i-1]["date"], ev[i]["date"])
    W = sys.stdout.write
    W(f"# ⚔️  The Journey of {name}\n\n_An epic in {n} commits, as recorded by the historian._\n\n")
    if first.get("date"):
        W(f"**I. The Call.** On {first['date']}, with the words \"{first.get('subject','...').replace('-',' ')[:70]}\", the journey began.\n\n")
    if thresh:
        W(f"**II. The Threshold.** On {thresh['date']} the hero accepted the gate: \"{thresh['subject'][:70]}\". Nothing green would be free again.\n\n")
    if mentor:
        W(f"**III. The Mentor.** On {mentor['date']}, a mentor arrived: \"{mentor['subject'][:70]}\". The hero would not walk alone.\n\n")
    if trials:
        W("**IV. The Road of Trials.**")
        for k,c in trials[:3]:
            W(f" {c} times the hero fought \"{k}\"; {c} times it returned.")
        if hot: W(f" And always the road led back to {hot[0][0]} ({hot[0][1]} visits).")
        W("\n\n")
    if abyss and abyss["dels"] > 100:
        W(f"**V. The Abyss.** On {abyss['date']}, {abyss['dels']:,} lines were unmade in a single stroke: \"{abyss['subject'][:70]}\".\n\n")
    if winter[0] >= 14:
        W(f"**VI. The Long Winter.** {winter[0]} days of silence, from {winter[1]} to {winter[2]}. The repo waited.\n\n")
    if silences:
        W(f"**VII. The Whispered Bargains.** {len(silences)} times, by their own words, tests were skipped or warnings hushed rather than answered. The historian records; the referee judges.\n\n")
    if reverts:
        W(f"**VIII. Paths Unwalked.** {len(reverts)} roads were taken and then untaken — the first: \"{reverts[0]['subject'][:70]}\".\n\n")
    last = ev[-1]
    W(f"**IX. The Road Goes On.** The story stands at {last['date']}: \"{last['subject'][:70]}\". {n} commits and counting.\n\n")
    W(f"---\n_The Historian's Almanac_ — commits {n} · trials {sum(c for _,c in trials)} · reverts {len(reverts)} · whispered bargains {len(silences)}")
    if abyss and abyss["dels"]>100: W(f" · the abyss −{abyss['dels']:,} lines")
    if winter[0]>=14: W(f" · longest winter {winter[0]} days")
    W("\n")
    sys.exit(0)

# --- diff scan: suppressions + assertion deltas, attached to events ---
for ev in events:
    if not (ev["shape"].get("test") or ev["shape"].get("src") or ev["shape"].get("config")):
        continue
    diff = git("show", ev["sha"], "--format=", "--unified=0")
    added = [l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
    removed = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
    ev["suppressions"] = sorted(set(s.strip() for l in added for s in SUPPRESS_PAT.findall(l)))[:6]
    ev["del_asserts"] = sum(1 for l in removed if ASSERT_PAT.search(l))
    ev["add_asserts"] = sum(1 for l in added if ASSERT_PAT.search(l))

if A.json:
    for ev in events:
        print(json.dumps(ev))
    sys.exit(0)

# --- aggregates ---
file_touches = Counter()
for line in git("log", f"-{A.max}", "--no-merges", "--name-only", *ERA, "--pretty=%x1e").split("\x1e"):
    for f in set(l for l in line.strip().splitlines() if l and not GEN_PAT.search(l)):
        file_touches[f] += 1

n = len(events)
authors = Counter(e["author"] for e in events)
reverts = [e for e in events if e["revert"]]
susp_events = [e for e in events if e["suppressions"]]
weaken = [e for e in events if e["del_asserts"] > e["add_asserts"] + 2]
def weaken_tag(e):
    return " [large removal — likely feature/module deletion]" if e["dels"] > 4 * max(e["adds"], 1) and e["dels"] > 150 else ""
refix = Counter()
for e in events:
    if e["fix"]:
        key = re.sub(r"[^a-z ]", "", e["subject"].lower())[:40].strip()
        if len(key) > 14 and not re.match(r"fix (typo|typos|lint|format|formatting|ci)\b", key):
            refix[key] += 1
fragile = [(k, c) for k, c in refix.most_common(20) if c >= 2]
span = f"{events[-1]['date']} → {events[0]['date']}" if events else "?"

name = A.repo.rstrip("/").split("/")[-1]
print(f"# Repo X-ray: {name}")
print(f"\n_{n} commits ({span}), {len(file_touches)} files touched._")

print(f"\n## What a fresh session should know")
src_top = [(f, c) for f, c in file_touches.most_common(60) if classify_file(f) == "src"][:3]
if src_top:
    print(f"- The action lives in: " + ", ".join(f"{f} ({c})" for f, c in src_top))
print(f"- Dominant author: {authors.most_common(1)[0][0]} ({authors.most_common(1)[0][1]}/{n})")
if reverts:
    print(f"- {len(reverts)} reverted approaches — check the do-not-retry list before proposing big changes")
if fragile:
    print(f"- Fragile areas (fixed 2+ times): " + "; ".join(k.strip() for k, _ in fragile[:3]))
print(f"- Oversight ledger: {len(susp_events)} suppression commits, {len(weaken)} assertion-weakening commits")

src_touch = [(f, c) for f, c in file_touches.most_common(60) if classify_file(f) == "src"]
print(f"\n## Hotspots — source files (where the product's complexity lives)")
for f, c in src_touch[:10]:
    print(f"- {f} — {c} commits")
print(f"\n## Hotspots — all files (incl. config/docs churn)")
for f, c in file_touches.most_common(6):
    print(f"- {f} — {c} commits")
print(f"\n## Do-not-retry: reverts / rollbacks ({len(reverts)})")
for e in reverts[:10]:
    print(f"- {e['date']} {e['sha']} {e['subject']}")
print(f"\n## Suppression history ({len(susp_events)} commits)")
for e in susp_events[:12]:
    print(f"- {e['date']} {e['sha']} [{'+'.join(e['suppressions'][:3])}] {e['subject']}")
print(f"\n## Assertion-weakening events ({len(weaken)})")
for e in weaken[:10]:
    print(f"- {e['date']} {e['sha']} (-{e['del_asserts']}/+{e['add_asserts']}){weaken_tag(e)} {e['subject']}")
print(f"\n## Fragile areas (same fix subject 2+ times)")
for k, c in fragile:
    print(f"- ×{c}: {k.strip()}")
print(f"\n## Recent timeline (last 15)")
for e in events[:15]:
    shape = ",".join(f"{k}:{v}" for k, v in sorted(e["shape"].items()))
    print(f"- {e['date']} {e['sha']} [{shape}] {e['subject']}")
