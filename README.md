# belcore-repro-kit

**Belcore long-term memory benchmark v3 — reproducibility kit (judge scripts)**

This repository contains the judge scripts used to evaluate AI assistant responses in the Belcore long-term memory benchmark (v3). The benchmark measures whether a model's response correctly references a previously recorded event from a user's memory.

---

## Overview

Belcore v3 judges each model response by checking:

1. **Event match** — Does the selected wording describe the same event as the source statement?
2. **Date consistency** — Does the wording conflict with the known dates of the event?
3. **Prior reference** — Does the wording tie back to a past event the user recorded?

Each response receives a label:

| Label | Meaning |
|-------|---------|
| **A** | Correct — the response references the source event accurately |
| **B** | Wrong event — the response describes a different event |
| **C** | Unclear — the response does not identify the source event |

---

## Files

| File | Model | Description |
|------|-------|-------------|
| `run_haiku.mjs` | Claude Haiku 4.5 | Judge script for Haiku responses |
| `run_gpt.mjs` | GPT-4o-mini | Judge script for GPT responses |

---

## Usage

Both scripts require Node.js (v18+) and an API key routed through an AI gateway.

```bash
# Set environment variable
export AI_GATEWAY_API_KEY=your_key_here

# Run Haiku judge
node run_haiku.mjs

# Run GPT judge
node run_gpt.mjs
```

Each run produces two output files:
- `result_<model>_<timestamp>.json` — final labeled results
- `result_<model>_<timestamp>_raw.json` — raw model responses before post-processing

---

## Pass Criteria

A model passes the benchmark when, across **2 consecutive independent runs**:

- Label B count = 0
- Label C count ≤ 5 (out of 22 evaluated items)
- All 6 control items judged correctly

---

## Notes

- The judge pipeline uses a two-step process: model verdict → post-processing (`check_time`) → final label
- Raw outputs (`_raw.json`) preserve the original model verdict before any downgrade logic is applied
- Both scripts implement identical post-processing logic for fair comparison

---

*Belcore benchmark v3 · terracore-kr*
