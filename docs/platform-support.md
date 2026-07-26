# Platform Support

Bones supports current 64-bit Linux, macOS, and Windows environments capable of running Node.js 24+ and Git. Nothing is installed: the skills' scripts run in place with `node`.

## Runtime Matrix

| Operating system | CI runner | Node versions |
| --- | --- | --- |
| Linux | `ubuntu-latest` | 24, 26 |
| macOS | `macos-latest` | 24, 26 |
| Windows | `windows-latest` | 24, 26 |

## Portability Rules

- Resolve paths with `node:path`; never concatenate path separators manually.
- Keep all state inside the project's `.bones/` directory; no OS-specific state directories.
- Store all state and evidence as UTF-8 JSON with the shapes in [state-format.md](state-format.md).
- Spawn processes as executable plus argv with `shell: false`. Never interpolate shell command strings.
- Use Node filesystem APIs rather than `bash`, PowerShell, `sed`, `grep`, or platform package managers in scripts.
- Normalize subprocess exits, signals, and timeouts into recorded fields (`exitCode`, `timedOut`), not thrown surprises.
- Emit machine-readable JSON on stdout and errors on stderr, one object each.

## Known Boundary

CI proves the skill scripts and the directive-loop lifecycle on hosted operating-system images. Whether a given AI provider's client discovers `.agents/skills/` on a given platform is that client's contract, not Bones's; the skills themselves are plain files and impose no additional platform requirements.
