---
name: bones-review
description: Independent review phase of the Bones quality workflow. Reviews the exact validated commit with a distinct actor and records structured findings. Load only when the Bones directive loop returns a review directive. Never activate outside an active Bones run.
---

# Bones — Independent Review

In this skill, `<skill:bones>` means the directory of the `bones` router skill (a sibling of this skill's directory).

The directive names the exact `gitSha` to review. Review that commit — not the conversation, not your memory of writing it.

## Independence Requirement

When the run policy sets `requireIndependentActor` (the default), the reviewer's `actor.id` must differ from the implementer's `actor.id` in `implementation.json`. Satisfy this by handing the review to a genuinely distinct actor, in order of preference:

1. A subagent or separate agent session with a different stable identity (e.g. a review-focused subagent, a different provider's CLI, or a second model).
2. A human reviewer, when the user offers.

Give the reviewing actor: the run's work contract, the diff to review (`git diff <baseSha>..<gitSha>` from run.json's `baseSha`), and the finding format below. The reviewing actor must not change code.

If no independent actor is available in your environment, tell the user and stop — do not review your own implementation under a cosmetically different id. That defeats the gate rather than passing it.

## What to Review

Correctness against the work contract, regressions, security, silent failures, and unnecessary complexity. Severity meanings:

- `critical` — must not ship; data loss, security, corruption, or broken core behavior.
- `major` — blocks this run per default policy; wrong behavior or a hole in the contract.
- `minor` / `suggestion` — recorded, non-blocking.

## Record the Evidence

Write `.bones/runs/<run-id>/review.json`:

```json
{
  "gitSha": "<directive.gitSha>",
  "summary": "Review conclusion",
  "actor": {
    "id": "<independent actor identity>",
    "provider": "<provider>",
    "model": "<optional model>",
    "role": "reviewer"
  },
  "findings": [
    {
      "severity": "major",
      "title": "Concise finding",
      "detail": "Impact and concrete correction",
      "file": "optional/path.ts",
      "line": 42
    }
  ]
}
```

Use an empty `findings` array only after the independent actor actually reviewed the diff. Record the findings exactly as the reviewer produced them — do not soften severities to pass the gate.

## Hand Back

Rerun `node <skill:bones>/scripts/next.mjs <run-id>`:

- No blocking findings → the directive advances to `verify`.
- Blocking findings → the directive returns to `fix`; the implementer addresses them in a new commit, which invalidates this review and requires a fresh one.
