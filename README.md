# Bones

Bones is a deterministic, provider-neutral quality workflow for AI-assisted software development. A single Agent Skill tells any AI provider how to ask the `bones` CLI for its next directive; the CLI owns workflow state, evidence, gates, and recovery.

Bones is explicitly opt-in. It must not activate for ordinary work unless the user names Bones or invokes `$bones` for that task.

## Status

Bones has a runnable local MVP: an Effect-based CLI, append-only integrity-checked run state, a canonical provider-neutral Agent Skill, deterministic Git-SHA-bound quality gates, and a three-OS CI contract.

## Requirements

- Node.js 22 or 24 LTS
- Git
- pnpm 10 for development

Linux, macOS, and Windows are first-class targets and are exercised in CI.

## Development

```bash
pnpm install
pnpm check
pnpm build
node dist/cli.js doctor --json
```

From a cloned checkout, install the CLI with `npm install --global .` after the build. npm creates the native `bones` launcher on Linux, macOS, and Windows; using a Node version manager avoids system-directory permission problems.

To expose the canonical skill to skills-compatible agents in the current project:

```bash
node dist/cli.js skill-install --json
```

After installing the package globally, use `bones skill-install`; add `--user` for the cross-project `~/.agents/skills/bones` location. The default project-local `.agents/skills/bones` convention is shared by compatible clients rather than tied to one AI provider.

## Initial CLI

```bash
bones doctor
bones skill-install
bones init
bones start --request "Fix the requested behavior. Acceptance criterion: the focused test passes."
bones status <run-id>
bones next <run-id>
bones exec <run-id> <directive-id> <check-id>
bones submit <run-id> <directive-id> <payload-file>
```

The agent-facing commands emit JSON with `--json`. Human-readable output is the default in a terminal.

See [docs/product-spec.md](docs/product-spec.md), [docs/architecture.md](docs/architecture.md), [docs/cli-protocol.md](docs/cli-protocol.md), and [docs/platform-support.md](docs/platform-support.md) for the design contract.
