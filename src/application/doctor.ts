import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { getStateHome } from "./project.js";
import { isSupportedPlatform } from "../platform/paths.js";
import { runProcess } from "../platform/process-runner.js";

export interface DoctorReport {
  readonly healthy: boolean;
  readonly platform: {
    readonly value: NodeJS.Platform;
    readonly supported: boolean;
  };
  readonly node: {
    readonly version: string;
    readonly supported: boolean;
    readonly testedLts: boolean;
  };
  readonly git: {
    readonly available: boolean;
    readonly version: string | null;
  };
  readonly state: {
    readonly path: string;
    readonly writable: boolean;
  };
}

function testStateDirectory(stateHome: string): Effect.Effect<boolean> {
  return Effect.tryPromise({
    try: async () => {
      await mkdir(stateHome, { recursive: true });
      const probe = path.join(stateHome, `.write-probe-${randomUUID()}`);
      const handle = await open(probe, "wx");
      await handle.close();
      await rm(probe, { force: true });
      return true;
    },
    catch: () => false,
  }).pipe(Effect.catchAll(() => Effect.succeed(false)));
}

export function runDoctor(): Effect.Effect<DoctorReport> {
  return Effect.gen(function* () {
    const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    const stateHome = getStateHome();
    const [gitResult, stateWritable] = yield* Effect.all([
      runProcess({ argv: ["git", "--version"], cwd: process.cwd(), timeoutMs: 15_000 }).pipe(
        Effect.match({
          onFailure: () => ({ available: false, version: null }),
          onSuccess: (result) => ({
            available: result.exitCode === 0,
            version: result.exitCode === 0 ? result.stdout.trim() : null,
          }),
        })
      ),
      testStateDirectory(stateHome),
    ]);
    const platformSupported = isSupportedPlatform(process.platform);
    const nodeSupported = nodeMajor >= 22;
    return {
      healthy: platformSupported && nodeSupported && gitResult.available && stateWritable,
      platform: { value: process.platform, supported: platformSupported },
      node: {
        version: process.versions.node,
        supported: nodeSupported,
        testedLts: nodeMajor === 22 || nodeMajor === 24,
      },
      git: gitResult,
      state: { path: stateHome, writable: stateWritable },
    };
  });
}
