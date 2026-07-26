# State Format

All Bones state is UTF-8 JSON under the project's Git-ignored `.bones/` directory. This document is the contract for those files. The bundled scripts validate these shapes on read and refuse to advance on malformed input.

## `.bones/project.json`

```json
{
  "schemaVersion": 2,
  "name": "my-project",
  "projectId": "39058601-313d-4644-8745-da6cc3f61c22",
  "createdAt": "2026-07-26T00:00:00.000Z"
}
```

## `.bones/workflow.json`

Editable policy. Edits affect only runs started afterward; each run snapshots policy immutably.

```json
{
  "schemaVersion": 2,
  "validation": {
    "checks": [
      { "id": "check", "argv": ["pnpm", "check"], "timeoutMs": 300000 }
    ]
  },
  "review": {
    "requireIndependentActor": true,
    "blockingSeverities": ["critical", "major"]
  },
  "verification": {
    "requireCleanWorktree": true,
    "requireCriterionCoverage": true
  }
}
```

Rules: check ids unique and non-empty; `argv` a non-empty array of non-empty strings (never a shell string); `timeoutMs` a positive integer. Omitted `review`/`verification` fields default to the strict values shown above.

## `.bones/runs/<run-id>/run.json`

Written once by `start.mjs`; never edited.

```json
{
  "schemaVersion": 2,
  "runId": "run-001-e16b713",
  "projectId": "…",
  "request": "Work contract with explicit acceptance criteria.",
  "baseSha": "…",
  "policy": { "validation": { "…": "…" }, "review": { "…": "…" }, "verification": { "…": "…" } },
  "createdAt": "…"
}
```

## `.bones/runs/<run-id>/implementation.json`

Overwritten each time a new implementation commit is recorded; always describes the latest one.

```json
{
  "gitSha": "<commit being certified>",
  "summary": "What changed and why",
  "actor": { "id": "claude-code:model", "provider": "claude-code", "model": "…", "role": "implementer" }
}
```

`actor.id` and `actor.provider` are required everywhere an actor appears. `actor.id` must be stable within a run and is compared verbatim for review independence.

## `.bones/runs/<run-id>/checks/<check-id>.json`

Written only by `check.mjs`. Re-running a check supersedes its previous record.

```json
{
  "checkId": "check",
  "gitSha": "…",
  "argv": ["pnpm", "check"],
  "exitCode": 0,
  "timedOut": false,
  "durationMs": 41230,
  "stdoutDigest": "<sha256>",
  "stderrDigest": "<sha256>",
  "stdoutTail": "…last 4000 chars…",
  "stderrTail": "…",
  "at": "…"
}
```

A check satisfies the gate only when its `gitSha` equals the recorded implementation SHA and `exitCode` is `0`.

## `.bones/runs/<run-id>/review.json`

```json
{
  "gitSha": "…",
  "summary": "Review conclusion",
  "actor": { "id": "codex:other", "provider": "codex", "role": "reviewer" },
  "findings": [
    { "severity": "major", "title": "…", "detail": "…", "file": "optional/path.ts", "line": 42 }
  ]
}
```

Severities: `critical`, `major`, `minor`, `suggestion`. Findings whose severity appears in the run's `blockingSeverities` route the workflow to `fix`.

## `.bones/runs/<run-id>/verification.json`

```json
{
  "gitSha": "…",
  "summary": "Verification conclusion",
  "actor": { "id": "…", "provider": "…", "role": "verifier" },
  "passed": true,
  "criteria": [
    { "id": "criterion-1", "passed": true, "evidence": "Exact command, observation, or artifact" }
  ]
}
```

Under `requireCriterionCoverage`, `passed: true` requires at least one criterion and every criterion passed with non-empty evidence; otherwise the directive returns to `verify`.

## Script Error Contract

Every script writes one JSON object to stdout on success. On failure it writes one JSON object to stderr — always containing `error` (a stable code) and `message` — and exits non-zero. Known codes include `missing-policy`, `invalid-policy`, `missing-run`, `invalid-run`, `invalid-evidence`, `malformed-json`, `unknown-run`, `ambiguous-run`, `unknown-check`, `no-implementation`, `sha-mismatch`, `git-unavailable`, `git-failed`, `spawn-failed`, `run-exists`, `no-runs`, and `usage`. Agents must surface these as blockers, not silently repair state to make them disappear.
