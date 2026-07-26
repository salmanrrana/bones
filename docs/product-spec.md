# Bones Product Specification

## Purpose

Bones extracts the quality workflow from a larger project-management application into two deliberately small products:

1. A standards-compatible Agent Skill that any compatible coding agent can discover and follow.
2. A local CLI that owns state, policy, evidence, concurrency, and workflow decisions.

There is no board, web server, provider SDK, prompt router, or required cloud account. Providers remain interchangeable because they all speak the same file-and-JSON CLI protocol.

Bones is opt-in per task. Naming or invoking Bones activates the workflow for that task only; ordinary requests must remain under the host agent's normal workflow.

## User Promise

Given the same recorded events and Git state, Bones returns the same next directive. It never claims that model output or external tools are deterministic. Instead, it turns their observable results into immutable evidence and applies deterministic gates to that evidence.

The first complete flow is:

```text
task snapshot
  -> implementation commit
  -> every configured check passes for that commit
  -> independent review has no policy-blocking findings
  -> every acceptance criterion is verified for that commit
  -> stop
```

Any new commit invalidates earlier check, review, and verification evidence for advancement purposes while retaining it for audit.

## Provider Contract

A provider needs only the ability to:

- discover and read a `SKILL.md` file;
- read and modify a local worktree;
- invoke `bones` with argv and parse JSON;
- create Git commits;
- hand off the review directive to a distinct actor when policy requires it.

Bones does not depend on provider session IDs or proprietary APIs. Actor records accept provider, model, and role metadata without using those strings to change gate behavior.

The canonical skill follows the open Agent Skills directory format. `bones skill-install` copies it to `.agents/skills/bones` for a project or `~/.agents/skills/bones` for a user. Provider-specific installers can be added as thin adapters only when a client does not scan that convention.

## Effect Grounding

Effect is the application foundation, not a claim that effects themselves are deterministic:

- Effect Schema validates every configuration, event, and submission boundary.
- Tagged errors keep failures visible and machine-classifiable.
- Effect programs describe asynchronous orchestration, concurrency, interruption, and cleanup.
- The workflow reducer and directive function remain pure TypeScript functions.
- Node and operating-system behavior stays behind narrow platform and storage modules.
- Event replay, not hidden mutable process state, reconstructs a run.

Future provider launchers, remote stores, telemetry exporters, and policy packs should enter as Effect services and Layers. They must not be imported into the pure domain kernel.

## State and Trust

Project policy, identity, and transient payloads live under the ignored `.bones/` directory. `bones init` adds `.bones/` to the repository's `.gitignore`, creating that file when absent. Teams may deliberately force-add selected policy files, but Bones does not do so automatically. Runtime events live in the native user-state directory, outside the worktree.

The local event store provides:

- one immutable event per UTF-8 JSON file;
- canonical JSON SHA-256 integrity hashes and previous-hash chaining;
- exclusive append locking and stale-lock recovery;
- expected-revision concurrency checks;
- idempotency keys;
- temporary-file write, sync, and atomic rename.

This detects accidental corruption and local edits; it is not a defense against an administrator or malicious process that can rewrite the entire state directory. Signed events or a remote transparency log are possible later adapters.

## Portability Definition

Supported means the same package and CLI protocol run on Linux, macOS, and native Windows with Node.js 22 or 24 LTS and Git. Product code uses Node path/filesystem APIs and executable-plus-argv spawning, not Bash or PowerShell scripts. CI contains all six OS/Node combinations and runs type checking, build, unit tests, a complete CLI lifecycle, skill validation, and `doctor`.

Local development currently proves Linux. Hosted macOS and Windows support becomes verified when the repository is pushed and its matrix completes; documentation must not describe an unrun matrix as observed proof.

## MVP Boundary

Included now:

- project and user skill installation;
- explicit invocation with implicit activation disabled on supporting hosts;
- inline request capture without task or ticket files;
- project initialization and validation-command detection for Node, Rust, and Go;
- resumable task runs;
- Git-SHA and policy snapshots;
- recorded command execution;
- structured independent review findings;
- structured acceptance-criterion verification;
- stale-directive, revision-conflict, and integrity protection;
- machine-readable and human CLI output.

Deferred deliberately:

- direct provider launching and credentials;
- hosted collaboration or remote event synchronization;
- signed releases and automatic updates;
- Windows ARM and Linux distribution-specific support guarantees;
- container/sandbox orchestration for clean-room verification;
- cryptographic actor identity and remote attestation;
- a UI or project-management layer.

These additions may extend adapters and evidence types, but may not weaken the central rule: only the deterministic kernel advances a run.
