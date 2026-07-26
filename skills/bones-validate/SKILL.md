---
name: bones-validate
description: Validation phase of the Bones quality workflow. Runs every configured check through the recording script so results become immutable evidence. Load only when the Bones directive loop returns a validate directive. Never activate outside an active Bones run.
---

# Bones — Validate

In this skill, `<skill:bones>` means the directory of the `bones` router skill (a sibling of this skill's directory).

The directive's `requiredChecks` lists every check that has not yet passed for the current implementation commit. Your only job is to run them through the recorder.

## Run Each Required Check

For every check id in `requiredChecks`, in order:

```text
node <skill:bones>/scripts/check.mjs <run-id> <check-id>
```

The script executes the argv snapshotted when the run started, records exit code, duration, and output digests into `.bones/runs/<run-id>/checks/<check-id>.json`, and prints the result.

## Rules

- Never run the check's underlying command directly and claim the gate from its output. Only `check.mjs` produces valid evidence.
- Never edit a `checks/*.json` file. If a recording is wrong, rerun `check.mjs` — a newer record for the same check id supersedes the old one.
- A non-zero exit or timeout is a recorded fact, not an error in the protocol. Do not retry a failing check hoping for flakiness more than once; if it fails twice, the code needs fixing.
- Do not modify code during this phase. If a check fails, the directive loop will route you to `fix`.

## Hand Back

After all required checks have been run (passing or not), rerun `node <skill:bones>/scripts/next.mjs <run-id>`:

- All passed → the directive advances to `review`.
- Any failed → the directive returns to `fix` with the failure as context.
