---
name: bones
description: Explicitly invoked, provider-neutral quality workflow for software tasks — implementation, validation, independent review, and acceptance verification, driven entirely by skills and recorded file evidence. Use only when the user names Bones, invokes $bones, or explicitly says to run the current task on or through Bones. Do not activate for ordinary coding, review, debugging, planning, or operational requests that do not explicitly request Bones.
---

# Bones

Proceed only because the user explicitly invoked Bones for the current task. Do not carry Bones into later tasks unless the user explicitly invokes it again.

Bones is a skills-only workflow. There is no CLI, server, or database. Workflow truth lives in two places:

1. **Recorded evidence** — JSON files under `.bones/runs/<run-id>/`, each bound to an exact Git commit SHA.
2. **The directive scripts** — small dependency-free Node scripts inside this skill that read the evidence plus Git state and print the one valid next action.

You never decide the current phase from memory or conversation. You always ask the directive script.

## Requirements

Node.js 24+ and Git on PATH. Run every script from the project worktree. All scripts print JSON to stdout on success and a JSON error to stderr with a non-zero exit on failure.

Throughout this skill, `<skill>` means the directory containing this SKILL.md file.

## Initialize the Project (once)

If `.bones/project.json` does not exist:

1. Create `.bones/` and add a `.bones/` line to the repository's `.gitignore` (create `.gitignore` if absent).
2. Write `.bones/project.json`:

```json
{
  "schemaVersion": 2,
  "name": "<repository directory name>",
  "projectId": "<random UUID>",
  "createdAt": "<ISO timestamp>"
}
```

3. Write `.bones/workflow.json` with at least one real validation check discovered from the project (for example the project's typecheck+test command). Every check needs a unique `id`, an `argv` array (never a shell string), and a positive `timeoutMs`:

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

Show the user the checks you chose and adjust if they object.

## Start or Resume

- **Resume**: run `node <skill>/scripts/next.mjs` (add the run id if several exist). Continue from the printed directive. Resume after interruptions; do not start a second run because a run is difficult.
- **Start**: condense the user's request, constraints, and acceptance criteria into one inline work-contract string. Each acceptance criterion must be individually checkable. Then:

```text
node <skill>/scripts/start.mjs --request "<work contract>"
```

Do not create a ticket, task file, plan file, or backlog item for Bones intake.

## The Directive Loop

Repeat until the directive kind is `stop`:

1. Run `node <skill>/scripts/next.mjs <run-id>`.
2. Read `kind`, `gitSha`, `reason`, and any `requiredChecks` / `blockingFindings`.
3. Load the matching phase skill and do exactly what it says:

| Directive kind | Phase skill to load |
| --- | --- |
| `configure` | fix `.bones/workflow.json`, then start a new run (policy is immutable per run) |
| `implement`, `fix` | `bones-implement` |
| `validate` | `bones-validate` |
| `review` | `bones-review` |
| `verify` | `bones-verify` |
| `stop` | report and stop (below) |

4. After completing the phase skill's action, immediately rerun `next.mjs`. Never chain two phases from one directive — evidence you just recorded changes the directive.

The directive script re-derives everything from files and Git on every call, so a stale belief about the phase is always corrected by rerunning it.

## `stop`

Report to the user: the run id, final Git SHA, every recorded check result, the review summary and findings count, and each acceptance criterion with its evidence. Then stop. This is the only successful terminal state.

## Use Available Tools

Use whatever tools the task requires — provider-native tools, test runners, browsers, containers, GitHub clients. Bones controls phase transitions and evidence; it does not restrict your toolbox. Keep external side effects within the authority granted by the user's request.

## Protocol Integrity

- Never write evidence for a Git SHA other than the one the directive names.
- Never edit or delete files under `.bones/runs/` except by appending new evidence as a phase skill instructs; recorded evidence is immutable.
- Never mark a check passed without a recorded `checks/<id>.json` produced by `check.mjs`.
- Never substitute an ad hoc command result for a configured check.
- If any script reports malformed or invalid evidence, surface it to the user as a blocker; do not silently rewrite files to make the error disappear.
- If the same directive persists after you recorded its evidence, the evidence did not satisfy the gate. Read the `reason` field and fix the actual deficiency; do not loop blindly more than twice — escalate to the user instead.
