# Bones Agent Instructions

Bones is a skills-only quality workflow. The product is the `skills/` directory; there is no CLI, build step, or runtime dependency.

## Architecture Rules

- Workflow truth lives in the directive computation (`skills/bones/scripts/`) and recorded evidence files — never in prose alone. If a gate matters, `next.mjs` must compute it; the phase skills explain it.
- Scripts must stay dependency-free ES modules requiring only Node 22+ and Git. No npm dependencies, no build step, no installation.
- Spawn subprocesses as executable plus argv with `shell: false`. Do not construct shell command strings.
- Bind all evidence to the exact Git SHA it certifies. New commits must invalidate downstream evidence.
- Keep every skill's frontmatter to `name` and `description`, in that order, and keep descriptions explicit that Bones is opt-in (router) or loop-only (phase skills).
- Treat Linux, macOS, and Windows as supported. Use `node:path` helpers; no Bash/PowerShell in scripts.
- Keep docs in `docs/` consistent with script behavior; docs must not describe enforcement the scripts do not compute.

## Completion

Run `node scripts/validate-skills.mjs` before considering a change complete. It validates skill structure and exercises the full directive loop (including gate rejections) in a temporary repository, and must pass on all three CI operating systems.
