import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectValidationChecks } from "../src/application/project.js";
import { decodeWorkflowConfig } from "../src/domain/config.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "bones-project-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("detectValidationChecks", () => {
  it("prefers a package check script and the lockfile-selected package manager", async () => {
    const root = await temporaryDirectory();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { check: "tsc && vitest", test: "vitest" } }),
      "utf8"
    );
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    await expect(detectValidationChecks(root)).resolves.toEqual([
      { id: "check", argv: ["pnpm", "check"], timeoutMs: 300_000 },
    ]);
  });

  it("detects a portable Go project fallback", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "go.mod"), "module example.test/bones\n", "utf8");

    await expect(detectValidationChecks(root)).resolves.toEqual([
      { id: "go-test", argv: ["go", "test", "./..."], timeoutMs: 900_000 },
    ]);
  });
});

describe("decodeWorkflowConfig", () => {
  const base = {
    schemaVersion: 1 as const,
    review: {
      requireIndependentActor: true,
      blockingSeverities: ["critical", "major"] as const,
    },
    verification: {
      requireCleanWorktree: true,
      requireCriterionCoverage: true,
    },
  };

  it("rejects empty argv and duplicate check IDs at the boundary", () => {
    expect(() =>
      decodeWorkflowConfig({
        ...base,
        validation: { checks: [{ id: "check", argv: [], timeoutMs: 1 }] },
      })
    ).toThrow("must define at least one argv item");

    expect(() =>
      decodeWorkflowConfig({
        ...base,
        validation: {
          checks: [
            { id: "check", argv: ["one"], timeoutMs: 1 },
            { id: "check", argv: ["two"], timeoutMs: 1 },
          ],
        },
      })
    ).toThrow("duplicated");
  });
});
