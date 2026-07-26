---
name: bones
description: Explicitly invoked, provider-neutral software implementation, validation, review, and verification through the Bones CLI. Use only when the user names Bones, invokes $bones, or explicitly says to run the current task on or through Bones. Do not activate for ordinary coding, review, debugging, planning, or operational requests that do not explicitly request Bones.
---

# Bones

Proceed only because the user explicitly invoked Bones for the current task. Do not carry Bones into later tasks unless the user explicitly invokes it again. Use the `bones` CLI as the source of workflow truth while preserving the user's control over scope.

## Start or Resume

1. Run `bones doctor --json` from the project worktree. Stop and report the returned error if Bones, Git, the platform, or the state directory is unhealthy.
2. Run `bones init --json` when `.bones/project.json` is absent.
3. Inspect `.bones/workflow.json`. Ensure `validation.checks` contains at least one command expressed as an argv array, never as a shell string.
4. To resume, run `bones list --json`, select the run explicitly named by the user or the only active run, then run `bones next --json <run-id>`.
5. To start, preserve the user's request, constraints, and acceptance criteria in one inline work-contract string, then run `bones start --json --request "<work contract>"`.

Do not start a second run merely because a run is difficult. Resume from the recorded directive after interruptions or provider handoffs.
Do not create a ticket, task file, plan file, or backlog item for Bones intake.

## Use Available Tools

Use whatever tools the task requires, including provider-native tools, `acli`, `pup`, GitHub clients, browsers, test runners, containers, and observability tools. Bones controls phase transitions and evidence; it does not replace or restrict the agent's toolbox. Keep external side effects within the authority granted by the user's request.

## Execute the Directive Loop

Run `bones next --json <run-id>`. Read `directive.id`, `directive.kind`, `directive.gitSha`, and `directive.requiredChecks`. Perform only the matching action below. After every action, call `bones next --json <run-id>` again because every recorded event changes the directive ID.

### `configure`

Add explicit validation checks to `.bones/workflow.json`. Each check must have a unique `id`, a non-empty `argv`, and a positive `timeoutMs`. Because run policy is immutable, start a new run after correcting a legacy run that reached this directive.

### `implement` or `fix`

Implement the task or address every blocking finding. Run focused diagnostics as useful, but do not claim the validation gate from ad hoc commands. Commit the resulting code, obtain the exact Git SHA, and write a JSON payload under `.bones/evidence/`:

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

Submit it with `bones submit --json <run-id> <directive-id> <payload-file>`. Project initialization excludes `.bones/evidence/` from Git so protocol payloads do not dirty the verified worktree. Store review and verification payloads there as well.

### `validate`

For every ID in `directive.requiredChecks`, run:

```text
bones exec --json <run-id> <directive-id> <check-id>
```

Refresh the directive after each check. Bones executes the command snapshot captured when the run started and records its exit code, duration, and output digests. Never substitute an unrecorded check result. Fix the code through the next `fix` or `implement` directive when checks cannot pass.

### `review`

Use an actor whose stable identity differs from the implementer when independent review is required. Review the exact `directive.gitSha` for correctness, regressions, security, silent failures, and unnecessary complexity. Do not change code during this directive. Write structured evidence:

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

Use an empty `findings` array only after actually reviewing the diff. Submit the payload with `bones submit --json <run-id> <directive-id> <payload-file>`. Bones derives the blocking count from the run's snapshotted severity policy.

### `verify`

Verify the acceptance criteria against the exact reviewed SHA. Use a clean environment when feasible and capture concrete evidence for each criterion. Write:

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

Submit it with `bones submit --json <run-id> <directive-id> <payload-file>`. Do not mark `passed` true with missing or failing criterion evidence. Bones also rejects passing verification when the Git worktree has non-ignored changes if the run requires a clean worktree.

### `stop`

Stop work and report the run ID, final Git SHA, recorded checks, review result, and criterion evidence. This is the only successful terminal state.

## Preserve Protocol Integrity

- Never edit the Bones runtime state directory or event files.
- Never reuse a directive ID after any event has been recorded.
- Never submit evidence for a different Git SHA.
- Never collapse executable plus arguments into a shell command string.
- Treat stale directives, revision conflicts, invalid schemas, failed integrity checks, timeouts, and unavailable independent reviewers as visible blockers.
- Rerun `bones next --json <run-id>` after a stale-directive error; do not guess the current phase.
