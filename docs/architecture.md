# Bones Architecture

## Product Boundary

Bones contains two distributable pieces:

1. The canonical `skills/bones/SKILL.md` instruction package.
2. The `bones` CLI and deterministic workflow kernel.

The skill is a client of the CLI protocol. It is never a source of workflow truth.

## Deterministic Core

Effect supplies typed errors, schema validation, composition, interruption, and platform integration. Deterministic decisions come from the pure reducer plus captured events; Bones does not assume that an AI model or subprocess becomes deterministic merely because it runs inside an Effect program.

The core uses an event-sourced model:

```text
command -> decide -> events -> evolve -> state -> next directive
```

External work remains nondeterministic, including model output and subprocess behavior. Bones captures those results as typed, immutable evidence and makes all subsequent gate decisions deterministically.

Every recorded artifact is bound to:

- Run ID and event revision
- Git SHA
- Workflow configuration hash
- Actor and provider, plus model and role when available
- Idempotency key

Changing code after validation or review invalidates evidence tied to the previous SHA.

## Layers

```text
src/domain       Pure schemas, events, state evolution, directives
src/application  Effect use cases and orchestration
src/platform     Portable filesystem, path, hashing, and process adapters
src/storage      Append-only event persistence
src/cli.ts       CLI adapter
skills/bones     Provider-neutral Agent Skill
```

## Initial State Flow

```text
implementation -> validation -> review -> verification -> done
       ^              |           |             |
       +--------------+-----------+-------------+
                    failure or blocking finding
```

Only the workflow kernel may advance a run. Provider adapters may launch agents and normalize events, but cannot weaken gates.

## Persistence

Runtime state lives outside the source worktree in the operating system's application-state directory. Project policy lives in `.bones/workflow.json` and may be committed.

The first persistence adapter stores one immutable, hash-chained event per file with exclusive creation, idempotency keys, locks, atomic rename, and revision checks. This avoids a native database dependency while preserving crash recovery and portability. A SQLite projection may be added later without changing the event schemas.
