# Platform Support

Bones supports current 64-bit Linux, macOS, and Windows environments capable of running a supported Node.js LTS release.

## Runtime Matrix

| Operating system | CI runner | Node versions |
| --- | --- | --- |
| Linux | `ubuntu-latest` | 22, 24 |
| macOS | `macos-latest` | 22, 24 |
| Windows | `windows-latest` | 22, 24 |

## Portability Rules

- Resolve paths with `node:path`; never concatenate path separators manually.
- Resolve state directories from `BONES_STATE_HOME` first, then native OS conventions.
- Store configuration and protocol payloads as UTF-8 JSON with stable schemas.
- Resolve submission payload paths within the project root, including protection against symlink escapes.
- Invoke commands as executable plus argv. Do not interpolate shell command strings.
- Keep Windows command-wrapper behavior inside the process adapter.
- Use Node filesystem APIs rather than `bash`, PowerShell, `sed`, `grep`, or platform package managers in product code.
- Normalize provider exits, signals, timeouts, and cancellation into typed errors.
- Keep output machine-readable and write diagnostics separately from JSON results.

## State Locations

The default state roots are:

- Linux: `$XDG_STATE_HOME/bones` or `~/.local/state/bones`
- macOS: `~/Library/Application Support/Bones`
- Windows: `%LOCALAPPDATA%\Bones`

Set `BONES_STATE_HOME` to override these locations on any platform.

## Known Boundary

CI proves the CLI and workflow kernel on hosted operating-system images. Provider-specific launch adapters will have their own conformance tests because individual provider CLIs can support a narrower platform set than Bones itself.
