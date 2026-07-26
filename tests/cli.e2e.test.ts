import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { runProcess } from "../src/platform/process-runner.js";

const temporaryDirectories: string[] = [];
const cliPath = path.resolve("dist", "cli.js");

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "bones-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function command(cwd: string, argv: readonly [string, ...string[]]): Promise<string> {
  const result = await Effect.runPromise(runProcess({ argv, cwd, timeoutMs: 30_000 }));
  expect(result.exitCode, result.stderr || result.stdout).toBe(0);
  return result.stdout;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return command(cwd, ["git", ...args]);
}

async function bones(cwd: string, ...args: string[]): Promise<Record<string, any>> {
  const output = await command(cwd, [process.execPath, cliPath, ...args]);
  return JSON.parse(output) as Record<string, any>;
}

afterEach(async () => {
  delete process.env.BONES_STATE_HOME;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("Bones CLI lifecycle", () => {
  it("completes a SHA-bound run through every gate", async () => {
    const workspace = await temporaryDirectory();
    const root = path.join(workspace, "project");
    await mkdir(root);
    process.env.BONES_STATE_HOME = path.join(workspace, "state");

    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { check: "node check.mjs" } }),
      "utf8"
    );
    await writeFile(
      path.join(root, "check.mjs"),
      "import { access } from 'node:fs/promises';\nawait access('implementation.txt');\n",
      "utf8"
    );
    const skill = await bones(root, "skill-install", "--json");
    expect(skill).toMatchObject({ scope: "project", alreadyInstalled: false });

    await git(root, "init");
    await git(root, "config", "user.name", "Bones Test");
    await git(root, "config", "user.email", "bones@example.invalid");
    await git(root, "add", "package.json", "check.mjs", ".agents");
    await git(root, "commit", "-m", "test: base fixture");

    const initialized = await bones(root, "init", "--json");
    expect(initialized.workflow.validation.checks).toMatchObject([
      { id: "check", argv: ["npm", "run", "check"] },
    ]);
    expect((await git(root, "check-ignore", ".bones/project.json")).trim()).toBe(
      ".bones/project.json"
    );

    const started = await bones(
      root,
      "start",
      "--json",
      "--request",
      "Create implementation.txt. Acceptance criterion: the file exists."
    );
    expect(started.directive.kind).toBe("implement");

    await writeFile(path.join(root, "implementation.txt"), "implemented\n", "utf8");
    await git(root, "add", ".gitignore", "implementation.txt");
    await git(root, "commit", "-m", "feat: implement fixture");
    const sha = (await git(root, "rev-parse", "HEAD")).trim();

    const evidenceDirectory = path.join(root, ".bones", "evidence");
    await mkdir(evidenceDirectory, { recursive: true });
    const codePayload = path.join(evidenceDirectory, "code-payload.json");
    await writeFile(
      codePayload,
      JSON.stringify({
        gitSha: sha,
        summary: "Created the requested file.",
        actor: { id: "implementer", provider: "test", role: "implementer" },
      }),
      "utf8"
    );
    const afterCode = await bones(
      root,
      "submit",
      "--json",
      started.runId,
      started.directive.id,
      codePayload
    );
    expect(afterCode.directive).toMatchObject({ kind: "validate", requiredChecks: ["check"] });

    const checked = await bones(
      root,
      "exec",
      "--json",
      started.runId,
      afterCode.directive.id,
      "check"
    );
    expect(checked).toMatchObject({ checkId: "check", exitCode: 0 });
    expect(checked.next.kind).toBe("review");

    const reviewPayload = path.join(evidenceDirectory, "review-payload.json");
    await writeFile(
      reviewPayload,
      JSON.stringify({
        gitSha: sha,
        summary: "No blocking findings.",
        actor: { id: "reviewer", provider: "second-test", role: "reviewer" },
        findings: [],
      }),
      "utf8"
    );
    const afterReview = await bones(
      root,
      "submit",
      "--json",
      started.runId,
      checked.next.id,
      reviewPayload
    );
    expect(afterReview.directive.kind).toBe("verify");

    const verificationPayload = path.join(evidenceDirectory, "verification-payload.json");
    await writeFile(
      verificationPayload,
      JSON.stringify({
        gitSha: sha,
        summary: "The requested file exists and the configured check passed.",
        actor: { id: "verifier", provider: "third-test", role: "verifier" },
        passed: true,
        criteria: [{ id: "file-exists", passed: true, evidence: "npm run check exited 0" }],
      }),
      "utf8"
    );
    const completed = await bones(
      root,
      "submit",
      "--json",
      started.runId,
      afterReview.directive.id,
      verificationPayload
    );

    expect(completed.directive.kind).toBe("stop");
    expect(completed.currentSha).toBe(sha);
    expect(completed.evidence.checks).toHaveLength(1);
    expect(completed.evidence.review.blockingFindings).toBe(0);
    expect(completed.evidence.verification.passed).toBe(true);
  }, 30_000);
});
