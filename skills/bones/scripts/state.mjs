// Shared state helpers for the Bones skill scripts.
// Zero dependencies. Requires Node 22+ and Git on PATH.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export function fail(code, message, extra = {}) {
  process.stderr.write(`${JSON.stringify({ error: code, message, ...extra })}\n`);
  process.exit(1);
}

export function emit(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) fail("git-unavailable", `Git could not run: ${result.error.message}`);
  if (result.status !== 0) {
    fail("git-failed", `git ${args.join(" ")} exited ${result.status}`, {
      stderr: (result.stderr ?? "").trim(),
    });
  }
  return result.stdout.trim();
}

export function projectRoot(startDir = process.cwd()) {
  return git(startDir, ["rev-parse", "--show-toplevel"]);
}

export function bonesDir(root) {
  return join(root, ".bones");
}

export function runsDir(root) {
  return join(bonesDir(root), "runs");
}

export function runDir(root, runId) {
  return join(runsDir(root), runId);
}

export function readJsonFile(path, description) {
  if (!existsSync(path)) return null;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail("unreadable-file", `Could not read ${description} at ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail("malformed-json", `${description} at ${path} is not valid JSON. Fix or remove the file, then rerun.`);
  }
}

export function writeJsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function listRuns(root) {
  const dir = runsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function loadPolicy(root) {
  const path = join(bonesDir(root), "workflow.json");
  const policy = readJsonFile(path, "workflow policy");
  if (!policy) {
    fail(
      "missing-policy",
      `No workflow policy found at ${path}. Create .bones/workflow.json before starting a run.`
    );
  }
  return normalizePolicy(policy, path);
}

function normalizePolicy(policy, path) {
  const checks = policy?.validation?.checks;
  if (!Array.isArray(checks)) {
    fail("invalid-policy", `${path} must contain validation.checks as an array.`);
  }
  for (const check of checks) {
    const argvOk =
      Array.isArray(check?.argv) &&
      check.argv.length > 0 &&
      check.argv.every((part) => typeof part === "string" && part.length > 0);
    if (typeof check?.id !== "string" || check.id.length === 0 || !argvOk) {
      fail("invalid-policy", `${path}: every check needs a non-empty string id and a non-empty argv array.`);
    }
    if (!(Number.isInteger(check?.timeoutMs) && check.timeoutMs > 0)) {
      fail("invalid-policy", `${path}: check "${check.id}" needs a positive integer timeoutMs.`);
    }
  }
  const ids = checks.map((check) => check.id);
  if (new Set(ids).size !== ids.length) {
    fail("invalid-policy", `${path}: check ids must be unique.`);
  }
  return {
    validation: { checks },
    review: {
      requireIndependentActor: policy?.review?.requireIndependentActor !== false,
      blockingSeverities: Array.isArray(policy?.review?.blockingSeverities)
        ? policy.review.blockingSeverities
        : ["critical", "major"],
    },
    verification: {
      requireCleanWorktree: policy?.verification?.requireCleanWorktree !== false,
      requireCriterionCoverage: policy?.verification?.requireCriterionCoverage !== false,
    },
  };
}

function isActor(value) {
  return (
    typeof value?.id === "string" &&
    value.id.length > 0 &&
    typeof value?.provider === "string" &&
    value.provider.length > 0
  );
}

function invalid(name, path, detail) {
  return { valid: false, problem: `${name} at ${path} is invalid: ${detail}` };
}

export function loadRun(root, runId) {
  const dir = runDir(root, runId);
  const runPath = join(dir, "run.json");
  const run = readJsonFile(runPath, "run snapshot");
  if (!run) fail("missing-run", `No run snapshot at ${runPath}.`);
  if (
    typeof run.runId !== "string" ||
    typeof run.request !== "string" ||
    run.request.length === 0 ||
    typeof run.baseSha !== "string" ||
    !run.policy
  ) {
    fail("invalid-run", `${runPath} must contain runId, request, baseSha, and policy.`);
  }

  const implementation = readEvidence(join(dir, "implementation.json"), "implementation evidence", (value, path) => {
    if (typeof value.gitSha !== "string" || value.gitSha.length === 0)
      return invalid("implementation evidence", path, "gitSha is required");
    if (!isActor(value.actor)) return invalid("implementation evidence", path, "actor.id and actor.provider are required");
    return { valid: true, value };
  });

  const checksDir = join(dir, "checks");
  const checks = new Map();
  if (existsSync(checksDir)) {
    for (const entry of readdirSync(checksDir).filter((name) => name.endsWith(".json")).sort()) {
      const path = join(checksDir, entry);
      const record = readEvidence(path, `check evidence ${entry}`, (value, recordPath) => {
        if (typeof value.checkId !== "string" || value.checkId.length === 0)
          return invalid("check evidence", recordPath, "checkId is required");
        if (typeof value.gitSha !== "string" || value.gitSha.length === 0)
          return invalid("check evidence", recordPath, "gitSha is required");
        if (!Number.isInteger(value.exitCode)) return invalid("check evidence", recordPath, "exitCode must be an integer");
        return { valid: true, value };
      });
      if (record) checks.set(record.checkId, record);
    }
  }

  const review = readEvidence(join(dir, "review.json"), "review evidence", (value, path) => {
    if (typeof value.gitSha !== "string" || value.gitSha.length === 0)
      return invalid("review evidence", path, "gitSha is required");
    if (!isActor(value.actor)) return invalid("review evidence", path, "actor.id and actor.provider are required");
    if (!Array.isArray(value.findings)) return invalid("review evidence", path, "findings must be an array");
    for (const finding of value.findings) {
      if (typeof finding?.severity !== "string" || typeof finding?.title !== "string" || typeof finding?.detail !== "string") {
        return invalid("review evidence", path, "every finding needs severity, title, and detail");
      }
    }
    return { valid: true, value };
  });

  const verification = readEvidence(join(dir, "verification.json"), "verification evidence", (value, path) => {
    if (typeof value.gitSha !== "string" || value.gitSha.length === 0)
      return invalid("verification evidence", path, "gitSha is required");
    if (!isActor(value.actor)) return invalid("verification evidence", path, "actor.id and actor.provider are required");
    if (typeof value.passed !== "boolean") return invalid("verification evidence", path, "passed must be a boolean");
    if (!Array.isArray(value.criteria)) return invalid("verification evidence", path, "criteria must be an array");
    for (const criterion of value.criteria) {
      if (
        typeof criterion?.id !== "string" ||
        typeof criterion?.passed !== "boolean" ||
        typeof criterion?.evidence !== "string" ||
        criterion.evidence.length === 0
      ) {
        return invalid("verification evidence", path, "every criterion needs id, passed, and non-empty evidence");
      }
    }
    return { valid: true, value };
  });

  return { runId, dir, run, implementation, checks, review, verification };
}

function readEvidence(path, description, validate) {
  const value = readJsonFile(path, description);
  if (value === null) return null;
  const result = validate(value, path);
  if (!result.valid) fail("invalid-evidence", result.problem);
  return result.value;
}

export function nextDirective(root, state) {
  const { run, implementation, checks, review, verification } = state;
  const headSha = git(root, ["rev-parse", "HEAD"]);
  const worktreeClean = git(root, ["status", "--porcelain"]) === "";
  const base = {
    runId: state.runId,
    runDir: state.dir,
    request: run.request,
    headSha,
    worktreeClean,
  };

  const policy = run.policy;
  if (!Array.isArray(policy?.validation?.checks) || policy.validation.checks.length === 0) {
    return {
      ...base,
      kind: "configure",
      gitSha: null,
      reason:
        "This run was snapshotted without validation checks. Add checks to .bones/workflow.json and start a new run; run policy is immutable.",
    };
  }

  if (!implementation) {
    return {
      ...base,
      kind: "implement",
      gitSha: null,
      reason: "Implement the task, commit it, and record implementation.json with the exact commit SHA.",
    };
  }

  if (headSha !== implementation.gitSha) {
    return {
      ...base,
      kind: "implement",
      gitSha: headSha,
      reason:
        "Repository HEAD no longer matches the recorded implementation SHA. Record implementation.json for the current HEAD before continuing.",
    };
  }

  const pending = policy.validation.checks.filter((check) => {
    const record = checks.get(check.id);
    return !(record && record.gitSha === implementation.gitSha && record.exitCode === 0);
  });
  if (pending.length > 0) {
    return {
      ...base,
      kind: "validate",
      gitSha: implementation.gitSha,
      requiredChecks: pending,
      reason: "Run every pending validation check exactly as configured and record its evidence.",
    };
  }

  const reviewForSha = review && review.gitSha === implementation.gitSha ? review : null;
  if (!reviewForSha) {
    return {
      ...base,
      kind: "review",
      gitSha: implementation.gitSha,
      reason: "Review the exact validated commit and record structured findings.",
    };
  }
  if (policy.review.requireIndependentActor && reviewForSha.actor.id === implementation.actor.id) {
    return {
      ...base,
      kind: "review",
      gitSha: implementation.gitSha,
      reason:
        "An independent actor must review this run; the implementer cannot approve its own work. Record a review from a different actor id.",
    };
  }
  const blockingSeverities = new Set(policy.review.blockingSeverities);
  const blockingFindings = reviewForSha.findings.filter((finding) => blockingSeverities.has(finding.severity));
  if (blockingFindings.length > 0) {
    return {
      ...base,
      kind: "fix",
      gitSha: implementation.gitSha,
      blockingFindings,
      reason: `${blockingFindings.length} blocking review finding(s) must be fixed in a new commit.`,
    };
  }

  const verificationForSha =
    verification && verification.gitSha === implementation.gitSha ? verification : null;
  if (!verificationForSha) {
    return {
      ...base,
      kind: "verify",
      gitSha: implementation.gitSha,
      reason: "Verify every acceptance criterion against the reviewed commit and record criterion evidence.",
    };
  }
  if (
    verificationForSha.passed &&
    policy.verification.requireCriterionCoverage &&
    (verificationForSha.criteria.length === 0 ||
      verificationForSha.criteria.some((criterion) => !criterion.passed))
  ) {
    return {
      ...base,
      kind: "verify",
      gitSha: implementation.gitSha,
      reason:
        "Recorded verification claims passed=true without full passing criterion coverage. Re-verify and record honest criterion evidence.",
    };
  }
  if (!verificationForSha.passed) {
    return {
      ...base,
      kind: "fix",
      gitSha: implementation.gitSha,
      reason: "Verification failed. Fix the cause in a new commit.",
    };
  }
  if (policy.verification.requireCleanWorktree && !worktreeClean) {
    return {
      ...base,
      kind: "verify",
      gitSha: implementation.gitSha,
      reason:
        "The worktree has non-ignored changes, so the recorded verification does not certify the current tree. Clean the worktree, then re-verify.",
    };
  }

  return {
    ...base,
    kind: "stop",
    gitSha: implementation.gitSha,
    reason: "All quality gates passed for this commit. Report the final state and stop.",
  };
}

export function resolveRoot(argvRoot) {
  return projectRoot(argvRoot ? resolve(argvRoot) : process.cwd());
}
