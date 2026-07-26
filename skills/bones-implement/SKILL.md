---
name: bones-implement
description: Implementation and fix phase of the Bones quality workflow. Load only when the Bones directive loop returns an implement or fix directive. Never activate outside an active Bones run.
---

# Bones — Implement or Fix

In this skill, `<skill:bones>` means the directory of the `bones` router skill (a sibling of this skill's directory).

You are acting as the **implementer** for the current Bones run. The directive you received is `implement` (build the task) or `fix` (address the listed blocking findings or the failed verification).

## Do the Work

1. For `implement`: satisfy the run's work contract (the `request` field in the directive output). For `fix`: address every entry in `blockingFindings`, or the verification failure named in `reason` — nothing else; do not expand scope.
2. Run focused diagnostics freely while working, but remember: ad hoc commands never satisfy the validation gate. The validate phase records the real checks.
3. Commit the result with a clear message. Obtain the exact SHA with `git rev-parse HEAD`.

## Record the Evidence

Write `.bones/runs/<run-id>/implementation.json` (overwrite is expected here — this file always describes the latest implementation commit):

```json
{
  "gitSha": "<git rev-parse HEAD>",
  "summary": "What changed and why",
  "actor": {
    "id": "<stable actor identity>",
    "provider": "<provider>",
    "model": "<optional model>",
    "role": "implementer"
  }
}
```

Rules for `actor.id`:

- Use a stable identity for yourself, e.g. `claude-code:<model-id>`. Use the same id every time you implement in this run.
- Never reuse this id later when recording review evidence — review requires a distinct actor.

## Hand Back

Rerun `node <skill:bones>/scripts/next.mjs <run-id>` and follow the new directive. Do not run validation checks, review, or verification from this phase.
