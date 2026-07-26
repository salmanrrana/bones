# Bones Product Specification

## Purpose

Bones is a quality workflow for AI-assisted software development delivered **entirely as Agent Skills**. There is no CLI to install, no server, no database, and no provider SDK. A compatible coding agent discovers the skills, and the skills dictate the workflow: implementation, recorded validation, independent review, and per-criterion acceptance verification.

Bones is opt-in per task. Naming or invoking Bones activates the workflow for that task only; ordinary requests must remain under the host agent's normal workflow.

## Shape

Bones ships five skills:

| Skill | Role |
| --- | --- |
| `bones` | Router. Init, start/resume, the directive loop, stop reporting, integrity rules. Contains the directive scripts. |
| `bones-implement` | Implementation and fix phase. |
| `bones-validate` | Validation phase — runs configured checks through the recorder. |
| `bones-review` | Independent review phase with a distinct actor. |
| `bones-verify` | Acceptance-criterion verification phase. |

The `bones` skill bundles three dependency-free Node scripts (`start.mjs`, `next.mjs`, `check.mjs`). These are not a CLI product: they are skill assets, never installed onto PATH, never versioned separately, and invoked only as `node <skill>/scripts/…` by an agent following the skill. They exist because "what is the next phase?" and "did this check really pass?" must be computed from recorded files, not from a model's recollection.

## User Promise

Given the same recorded evidence files and Git state, the directive script returns the same next directive. Bones never claims model output or external tools are deterministic; it turns their observable results into recorded evidence and applies deterministic gates to that evidence.

The complete flow is:

```text
run snapshot
  -> implementation commit
  -> every configured check passes for that commit (recorded)
  -> independent review has no policy-blocking findings
  -> every acceptance criterion is verified for that commit
  -> stop
```

Any new commit invalidates earlier check, review, and verification evidence for advancement purposes while retaining it for audit inside the run directory.

## Enforcement Model — Honest Boundaries

A skills-only product cannot enforce the way a stateful backend can. Bones is explicit about its three enforcement tiers:

1. **Computed gates** (strongest): the directive and check scripts derive phase, SHA binding, check status, actor independence, and criterion coverage from files plus Git. An agent that follows the loop cannot skip a phase, because the loop only ever surfaces one valid action.
2. **Structural friction**: evidence schemas are validated on read; malformed or incomplete evidence produces a visible error instead of silent advancement.
3. **Instructions** (weakest): "don't edit recorded evidence," "hand review to a genuinely distinct actor," "capture honest criterion evidence." A determined or careless agent can violate these; the skills make violations detectable (SHA binding, evidence trails) rather than impossible.

Anything requiring tier-1 strength against an adversarial agent — cryptographic actor identity, tamper-proof event logs, runner-owned certification — is out of scope for the skills-only design and is listed as deferred.

## Provider Contract

A provider needs only the ability to:

- discover and read `SKILL.md` files in the open Agent Skills directory format;
- read and modify a local worktree;
- run `node` with argv and read stdout/stderr;
- create Git commits;
- hand the review directive to a distinct actor when policy requires it.

Installation is copying the `skills/` directories into `.agents/skills/` (project) or `~/.agents/skills/` (user) — a file copy any agent or human can perform; the `bones` skill's init section covers it.

## State and Trust

All state lives in the project worktree under the Git-ignored `.bones/` directory:

- `.bones/project.json` — project identity.
- `.bones/workflow.json` — validation checks, review policy, verification policy. Snapshotted immutably into each run at start.
- `.bones/runs/<run-id>/` — the run snapshot plus implementation, check, review, and verification evidence, each bound to an exact Git SHA.

There is no state outside the worktree. Moving or deleting `.bones/` deletes run history; teams may deliberately force-add selected files to Git for durability. Evidence files are plain JSON: readable, diffable, and auditable by humans. Integrity against a malicious writer is explicitly not claimed.

## Portability Definition

Supported means the skills and their scripts run on Linux, macOS, and native Windows with Node.js 22+ and Git. Scripts use Node path and filesystem APIs and argv spawning — no Bash, PowerShell, or shell-string interpolation. CI validates skill structure and runs the directive-loop exercise on all three operating systems.

## MVP Boundary

Included now:

- five skills in the open Agent Skills format;
- explicit invocation with implicit activation disabled in every description;
- inline request capture without ticket or task files;
- resumable runs recomputed from files and Git on every step;
- immutable per-run policy snapshots;
- recorded check execution with output digests;
- structured independent review findings;
- structured per-criterion verification;
- SHA-drift, self-review, and dishonest-coverage rejection in the directive script.

Deferred deliberately:

- any installed CLI, daemon, server, or database;
- provider launching and credentials;
- hosted collaboration or remote synchronization;
- hash-chained or signed event logs and cryptographic actor identity;
- container orchestration for clean-room verification;
- a UI or project-management layer.

These may return later as optional layers, but may not weaken the central rule: only the directive script decides the next phase.
