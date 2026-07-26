# Bones

Bones is a provider-neutral quality workflow for AI-assisted software development, delivered **entirely as Agent Skills**. There is no CLI, server, or database. Five skills — a router plus one per phase — walk any compatible coding agent through implementation, recorded validation, independent review, and per-criterion acceptance verification, with all evidence stored as plain JSON bound to exact Git commits.

Bones is explicitly opt-in. It must not activate for ordinary work unless the user names Bones or invokes `$bones` for that task.

## How It Works

The `bones` router skill bundles three tiny dependency-free Node scripts. Agents run them in place — nothing is installed:

- `start.mjs` snapshots the request, base commit, and quality policy into `.bones/runs/<run-id>/`.
- `next.mjs` reads the recorded evidence plus Git state and prints the one valid next directive.
- `check.mjs` executes a configured validation check and records its result as immutable evidence.

The agent loops: ask `next.mjs` → load the matching phase skill (`bones-implement`, `bones-validate`, `bones-review`, `bones-verify`) → do exactly that phase → ask again. The sequence is never remembered, always recomputed, so runs survive interruptions and provider handoffs.

```text
implement -> validate -> review -> verify -> stop
    ^            |          |          |
    +------------+----------+----------+
         failure or blocking finding -> fix
```

Gates the directive script computes: every configured check must pass for the exact implementation SHA; the reviewer's actor id must differ from the implementer's; blocking-severity findings force a fix commit (which invalidates prior evidence); verification must cover every acceptance criterion with real evidence; any new commit restarts the gates.

## Requirements

- Node.js 24+ and Git on PATH
- An agent that reads Agent Skills (`SKILL.md` directories)

## Install

Copy the five skill directories into a location your agent scans:

```bash
# project-local
cp -r skills/* .agents/skills/
# or user-wide
cp -r skills/* ~/.agents/skills/
```

(On Windows, copy the folders with Explorer or `robocopy` — the skills are plain files.)

Then invoke it: *"Run this task through $bones: … Acceptance criteria: …"*

## Repository Layout

```text
skills/bones            Router skill + scripts (the whole runtime)
skills/bones-implement  Implementation / fix phase
skills/bones-validate   Validation phase
skills/bones-review     Independent review phase
skills/bones-verify     Acceptance verification phase
docs/                   Product spec, architecture, state format, platform support
scripts/                Repo-side skill validation (development only)
```

## Development

```bash
node scripts/validate-skills.mjs   # validate skill structure and exercise the directive loop
```

No dependencies, no install step — the repository needs only Node 24+ and Git.

See [docs/product-spec.md](docs/product-spec.md), [docs/architecture.md](docs/architecture.md), [docs/state-format.md](docs/state-format.md), and [docs/platform-support.md](docs/platform-support.md).
