---
name: bones-verify
description: Acceptance verification phase of the Bones quality workflow. Verifies every acceptance criterion against the reviewed commit and records per-criterion evidence. Load only when the Bones directive loop returns a verify directive. Never activate outside an active Bones run.
---

# Bones — Verify Acceptance Criteria

In this skill, `<skill:bones>` means the directory of the `bones` router skill (a sibling of this skill's directory).

The directive names the exact reviewed `gitSha`. Verify the run's acceptance criteria against that commit.

## Extract the Criteria

Re-read the run's work contract (`request` in the directive output). Enumerate every acceptance criterion it states or clearly implies, giving each a stable id (`criterion-1`, `criterion-2`, …). If the contract has no checkable criteria, treat that as a blocker: report it to the user rather than inventing criteria that trivially pass.

## Verify Each Criterion

- Confirm `git rev-parse HEAD` equals `directive.gitSha` and the worktree is clean before verifying; the default policy requires a clean tree for the result to certify anything.
- Exercise the actual behavior — run the command, hit the endpoint, open the page, read the produced artifact. A criterion is not verified by pointing at the code that should implement it.
- Capture concrete evidence per criterion: the exact command and its observed output, or the specific observation made.
- Prefer a fresh environment when feasible (clean checkout, fresh install, or container) so the result does not depend on session state.

## Record the Evidence

Write `.bones/runs/<run-id>/verification.json`:

```json
{
  "gitSha": "<directive.gitSha>",
  "summary": "Verification conclusion",
  "actor": {
    "id": "<verifier identity>",
    "provider": "<provider>",
    "model": "<optional model>",
    "role": "verifier"
  },
  "passed": true,
  "criteria": [
    {
      "id": "criterion-1",
      "passed": true,
      "evidence": "Exact command, observation, or artifact"
    }
  ]
}
```

Set `passed: true` only when every criterion is individually passed with real evidence. The directive script rejects `passed: true` with missing or failing criterion coverage — recording it dishonestly just returns you to this phase.

## Hand Back

Rerun `node <skill:bones>/scripts/next.mjs <run-id>`:

- Passed → the directive becomes `stop`; report per the bones skill.
- Failed → the directive returns to `fix` with the failure as context.
