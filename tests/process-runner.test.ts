import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runProcess } from "../src/platform/process-runner.js";

describe("runProcess", () => {
  it("passes argv without shell interpolation and captures evidence", async () => {
    const result = await Effect.runPromise(
      runProcess({
        argv: [process.execPath, "-e", "process.stdout.write(process.argv[1])", "hello world;$HOME"],
        cwd: process.cwd(),
        timeoutMs: 10_000,
      })
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world;$HOME");
    expect(result.stderr).toBe("");
    expect(result.stdoutDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.truncated).toBe(false);
  });

  it("returns non-zero exits as validation evidence", async () => {
    const result = await Effect.runPromise(
      runProcess({
        argv: [process.execPath, "-e", "process.stderr.write('nope'); process.exit(7)"],
        cwd: process.cwd(),
        timeoutMs: 10_000,
      })
    );

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe("nope");
  });
});
