# Bones Architecture

## Product Boundary

Bones is a single distributable: the `skills/` directory. Five skills define the workflow; three bundled scripts inside the `bones` skill compute directives and record check evidence. Nothing is compiled, installed, or served.

```text
skills/bones            Router skill + scripts (start, next, check, shared state helpers)
skills/bones-implement  Implementation / fix phase skill
skills/bones-validate   Validation phase skill
skills/bones-review     Independent review phase skill
skills/bones-verify     Acceptance verification phase skill
```

## Control Flow

The `bones` skill runs a directive loop. Each iteration asks `next.mjs` for the one valid action, loads the matching phase skill, performs exactly that action, and asks again:

```text
next.mjs reads: run snapshot + evidence files + git HEAD + worktree status
          |
          v
   directive kind ---> phase skill ---> new evidence file / commit
          ^                                    |
          +------------------------------------+
```

```text
implement -> validate -> review -> verify -> stop
    ^            |          |          |
    +------------+----------+----------+
        check failure, blocking finding, or failed verification -> fix
```

The phase sequence is not stored anywhere; it is re-derived from evidence on every call. That is what makes runs resumable across sessions, providers, and interruptions: there is no in-memory workflow state to lose.

## Gate Rules (computed by `next.mjs`)

- No implementation recorded → `implement`.
- HEAD differs from the recorded implementation SHA → `implement` (drift invalidates everything downstream).
- Any configured check without a passing record for the implementation SHA → `validate` with the pending list.
- No review for the SHA → `review`. Reviewer id equal to implementer id under independent-actor policy → `review` again with the reason stated.
- Blocking-severity findings → `fix`.
- No verification for the SHA → `verify`. `passed: true` with missing or failing criterion coverage → `verify` again. `passed: false` → `fix`.
- Clean-worktree policy with a dirty tree → `verify` again after cleanup.
- Otherwise → `stop`.

## Evidence Layout

```text
.bones/
  project.json                     project identity
  workflow.json                    editable policy (snapshotted per run)
  runs/<run-id>/
    run.json                       immutable snapshot: request, baseSha, policy
    implementation.json            latest implementation commit + actor
    checks/<check-id>.json         one record per check, superseded by re-runs
    review.json                    findings + reviewer actor, bound to SHA
    verification.json              per-criterion evidence, bound to SHA
```

Every evidence file names the exact Git SHA it certifies. Evidence for an older SHA remains on disk for audit but can never satisfy a gate for a newer SHA.

## Scripts Are Skill Assets, Not a CLI

`start.mjs`, `next.mjs`, and `check.mjs` (plus the shared `state.mjs`) are plain ES modules with zero dependencies, requiring only Node 24+ and Git. They are invoked in place from the skill directory. Design rules:

- Pure functions of files + Git state; no hidden mutable state, no daemon, no lockfiles.
- JSON result on stdout, JSON error on stderr, non-zero exit on failure.
- Argv spawning only (`shell: false`); no shell-string construction anywhere.
- `check.mjs` executes the argv snapshotted at run start — never a caller-supplied command — and records exit code, duration, and output digests.

If a future need outgrows these constraints (remote state, signing, provider launching), that becomes a new optional layer — the skills must keep working without it.
