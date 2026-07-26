import { createHash } from "node:crypto";
import { Data, Effect } from "effect";
import spawn from "cross-spawn";

const MAX_CAPTURE_BYTES = 1024 * 1024;

export interface ProcessSpec {
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly timeoutMs: number;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly truncated: boolean;
}

export class ProcessExecutionError extends Data.TaggedError("ProcessExecutionError")<{
  readonly message: string;
  readonly argv: ReadonlyArray<string>;
}> {}

function appendBounded(current: string, chunk: Buffer): { value: string; truncated: boolean } {
  const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current);
  if (remaining <= 0) return { value: current, truncated: true };
  if (chunk.byteLength <= remaining) {
    return { value: current + chunk.toString("utf8"), truncated: false };
  }
  return {
    value: current + chunk.subarray(0, remaining).toString("utf8"),
    truncated: true,
  };
}

export function runProcess(spec: ProcessSpec): Effect.Effect<ProcessResult, ProcessExecutionError> {
  return Effect.async<ProcessResult, ProcessExecutionError>((resume) => {
    const [command, ...args] = spec.argv;
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    const stdoutHash = createHash("sha256");
    const stderrHash = createHash("sha256");

    const child = spawn(command, args, {
      cwd: spec.cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resume(
        Effect.fail(
          new ProcessExecutionError({
            message: `Command timed out after ${spec.timeoutMs}ms.`,
            argv: spec.argv,
          })
        )
      );
    }, spec.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutHash.update(chunk);
      const next = appendBounded(stdout, chunk);
      stdout = next.value;
      truncated ||= next.truncated;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrHash.update(chunk);
      const next = appendBounded(stderr, chunk);
      stderr = next.value;
      truncated ||= next.truncated;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resume(
        Effect.fail(
          new ProcessExecutionError({
            message: error.message,
            argv: spec.argv,
          })
        )
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const exitCode = code ?? 1;
      resume(
        Effect.succeed({
          exitCode,
          durationMs: Date.now() - startedAt,
          stdout,
          stderr,
          stdoutDigest: stdoutHash.digest("hex"),
          stderrDigest: stderrHash.digest("hex"),
          truncated,
        })
      );
    });

    return Effect.sync(() => {
      clearTimeout(timeout);
      if (!settled) child.kill("SIGTERM");
    });
  });
}
