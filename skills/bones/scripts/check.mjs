// Execute one configured validation check and record its evidence.
// Usage: node check.mjs <run-id> <check-id>
// Runs the argv snapshotted at run start — never an ad hoc command.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { emit, fail, git, loadRun, resolveRoot, writeJsonFile } from "./state.mjs";

const [runId, checkId] = process.argv.slice(2);
if (!runId || !checkId) fail("usage", "Usage: node check.mjs <run-id> <check-id>");

const root = resolveRoot();
const state = loadRun(root, runId);
const check = state.run.policy.validation.checks.find((entry) => entry.id === checkId);
if (!check) {
  fail("unknown-check", `Run ${runId} has no check named ${checkId}.`, {
    available: state.run.policy.validation.checks.map((entry) => entry.id),
  });
}

if (!state.implementation) {
  fail("no-implementation", "Record implementation.json before running validation checks.");
}
const headSha = git(root, ["rev-parse", "HEAD"]);
if (headSha !== state.implementation.gitSha) {
  fail(
    "sha-mismatch",
    `HEAD ${headSha} does not match the recorded implementation SHA ${state.implementation.gitSha}. Record the current commit first.`
  );
}

const startedAt = Date.now();
const [command, ...commandArgs] = check.argv;
const result = spawnSync(command, commandArgs, {
  cwd: root,
  encoding: "utf8",
  timeout: check.timeoutMs,
  maxBuffer: 64 * 1024 * 1024,
  shell: false,
});
const durationMs = Date.now() - startedAt;

if (result.error && result.error.code !== "ETIMEDOUT") {
  fail("spawn-failed", `Could not run ${check.argv.join(" ")}: ${result.error.message}`);
}

const timedOut = result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM";
const exitCode = timedOut ? -1 : (result.status ?? -1);
const digest = (text) => createHash("sha256").update(text ?? "", "utf8").digest("hex");

const record = {
  checkId,
  gitSha: headSha,
  argv: check.argv,
  exitCode,
  timedOut,
  durationMs,
  stdoutDigest: digest(result.stdout),
  stderrDigest: digest(result.stderr),
  stdoutTail: (result.stdout ?? "").slice(-4000),
  stderrTail: (result.stderr ?? "").slice(-4000),
  at: new Date().toISOString(),
};
writeJsonFile(join(state.dir, "checks", `${checkId}.json`), record);

emit({
  recorded: true,
  checkId,
  exitCode,
  timedOut,
  durationMs,
  passed: exitCode === 0,
});
