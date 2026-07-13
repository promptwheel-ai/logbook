# Bounded context format: mechanical measurement

This measures serialization only. It does not measure relevance, ranking,
agent behavior, task success, or token savings from avoided work.

## Method

- Date: 2026-07-13
- Implementation: the `0.8.0` `formatContextPage` contract
- Input: 7,123 already-ordered, path-selected event rows from ten open-source
  repository fixtures used by the development retrieval study
- Baseline bytes: `JSON.stringify(event) + "\n"` for every row
- Treatment bytes: every context page, including preambles and cursors, until
  `END complete`
- Order was fixed before formatting. The formatter performed no ranking.

## Result

| Measure | Result |
|---|---:|
| Ordered events | 7,123 |
| Raw JSONL bytes | 4,370,602 |
| Context-page bytes | 1,194,258 |
| Context / raw ratio | 27.3248% |
| Byte reduction | 72.7% |
| Pages | 361 |
| Exact traversals | 10/10 |
| Largest page | 4,542 bytes |
| Largest rendered row | 258 bytes |

There were no gaps, duplicates, or order changes. The public suite separately
locks the hard limits (20 rows, 8 KiB per page, 1 KiB per row), a synthetic
1,362-path/87 KiB event, cursor staleness and tamper rejection, Unicode and
terminal-control sanitization, and raw-query compatibility.

The fixture event ledgers are not included in this repository, so the 72.7%
dataset result is an internal mechanical measurement, not an independently
reproducible benchmark. The format contract and adversarial fixtures are
reproducible in `test/logbook.test.mjs`.

