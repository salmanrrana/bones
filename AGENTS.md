# Bones Agent Instructions

Bones is a provider-neutral quality workflow. Keep the workflow engine deterministic and keep provider adapters thin.

## Architecture

- Put state, events, transition rules, and directive generation in `src/domain/`.
- Put filesystem, process, operating-system, and provider behavior behind services or adapters.
- Never put authoritative transition logic in prompts, skills, hooks, or provider adapters.
- Bind validation, review, and verification evidence to the exact Git SHA it certifies.
- Use argv arrays for subprocesses. Do not construct shell command strings.
- Treat Linux, macOS, and Windows as supported platforms. Use `node:path` helpers and injected platform inputs instead of parsing paths manually.

## Completion

Run `pnpm check` before considering a code change complete. Cross-platform behavior must also remain covered by the GitHub Actions operating-system matrix.
