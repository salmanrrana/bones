# CLI Protocol

Bones is a local JSON protocol shared by humans, agent skills, and provider adapters. The stable automation form is:

```text
bones <command> --json [arguments]
```

## Lifecycle

```text
doctor -> skill-install -> init -> start -> next -> (submit | exec) -> next -> ... -> stop
```

`next` returns one directive with an ID derived from the current event revision, directive kind, and Git SHA. Mutating commands require that ID. A concurrent or repeated actor therefore receives a stale-directive or revision-conflict error instead of silently advancing stale state.

`start --request` snapshots the active request directly; it does not create a task or ticket file. Submission payloads must resolve inside the project root and should live in `.bones/evidence/`. `bones init` ensures the repository's `.gitignore` contains `.bones/`, creating `.gitignore` when necessary.

## Commands

| Command | Purpose |
| --- | --- |
| `doctor` | Check OS, Node, Git, and state storage |
| `skill-install [--user] [--force]` | Install the canonical skill in a standard project or user skill directory |
| `init` | Create committed project identity and workflow policy |
| `start --request <text>` | Snapshot the inline request, Git base, and complete quality policy |
| `list` | List resumable runs for this project |
| `status <run-id>` | Return state, evidence, and the current directive |
| `next <run-id>` | Return the only valid next action |
| `submit <run-id> <directive-id> <payload-file>` | Record typed implementation, review, or verification evidence |
| `exec <run-id> <directive-id> <check-id>` | Execute a snapshotted validation command and record evidence |

## Determinism Boundary

Model output and subprocess behavior are not deterministic. Bones makes gate decisions deterministic by recording typed facts and replaying pure state transitions. Each run snapshots its task, base Git SHA, validation argv, timeout policy, review policy, verification policy, and configuration digest. Evidence for an older code SHA remains auditable but cannot satisfy gates for a newer SHA.

## Error Contract

JSON mode writes one JSON result to standard output and one JSON error to standard error. Callers must treat a non-zero process exit as failure. They should refresh with `next` after stale directives and must not retry revision conflicts by inventing a new expected revision.
