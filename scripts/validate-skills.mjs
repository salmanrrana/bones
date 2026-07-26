// Validate the Bones skill suite: structure, frontmatter, and a full
// directive-loop lifecycle exercised in a temporary Git repository.
// Requires only Node 24+ and Git. Run with: node scripts/validate-skills.mjs

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const skillsRoot = join(repoRoot, "skills");
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

// --- Structure and frontmatter ---

const expected = ["bones", "bones-implement", "bones-validate", "bones-review", "bones-verify"];
for (const name of expected) {
  const path = join(skillsRoot, name, "SKILL.md");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    check(false, `${name}: missing SKILL.md`);
    continue;
  }
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    check(false, `${name}: SKILL.md must start with YAML frontmatter`);
    continue;
  }
  const metadata = frontmatter[1];
  const keys = [...metadata.matchAll(/^([a-zA-Z0-9_-]+):/gm)].map((match) => match[1]);
  check(keys.join(",") === "name,description", `${name}: frontmatter must contain only name and description, in order`);
  check(new RegExp(`^name: ${name}$`, "m").test(metadata), `${name}: frontmatter name must be ${name}`);
}

const routerText = readFileSync(join(skillsRoot, "bones", "SKILL.md"), "utf8");
check(/\$bones/.test(routerText), "bones: router must mention explicit $bones invocation");
for (const phase of ["bones-implement", "bones-validate", "bones-review", "bones-verify"]) {
  const text = readFileSync(join(skillsRoot, phase, "SKILL.md"), "utf8");
  const description = text.match(/^description: (.*)$/m)?.[1] ?? "";
  check(/Bones/.test(description), `${phase}: description must anchor to the Bones workflow`);
  check(/next\.mjs/.test(text), `${phase}: must hand back to the directive loop via next.mjs`);
}

// --- Lifecycle exercise ---

const scripts = join(skillsRoot, "bones", "scripts");
const temp = mkdtempSync(join(tmpdir(), "bones-validate-"));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: temp, encoding: "utf8", ...options });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result;
};
const node = (script, args, options) => run(process.execPath, [join(scripts, script), ...args], options);
const directive = (runId) => JSON.parse(node("next.mjs", runId ? [runId] : []).stdout);
const expectKind = (label, runId, kind) => {
  const result = directive(runId);
  check(result.kind === kind, `lifecycle ${label}: expected directive ${kind}, got ${result.kind} (${result.reason})`);
  return result;
};

try {
  run("git", ["init", "-q"]);
  run("git", ["config", "user.email", "ci@bones"]);
  run("git", ["config", "user.name", "bones-ci"]);
  writeFileSync(join(temp, "app.txt"), "hello\n");
  writeFileSync(join(temp, ".gitignore"), ".bones/\n");
  run("git", ["add", "-A"]);
  run("git", ["commit", "-qm", "base"]);

  mkdirSync(join(temp, ".bones"));
  writeFileSync(
    join(temp, ".bones", "project.json"),
    JSON.stringify({ schemaVersion: 2, name: "t", projectId: "ci", createdAt: new Date().toISOString() })
  );
  writeFileSync(
    join(temp, ".bones", "workflow.json"),
    JSON.stringify({
      schemaVersion: 2,
      validation: { checks: [{ id: "ok", argv: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 10000 }] },
    })
  );

  const started = JSON.parse(node("start.mjs", ["--request", "Test. Acceptance criterion: app.txt says hi."]).stdout);
  const runId = started.runId;
  const runDir = join(temp, ".bones", "runs", runId);
  const evidence = (file, value) => writeFileSync(join(runDir, file), JSON.stringify(value));

  expectKind("initial", runId, "implement");

  writeFileSync(join(temp, "app.txt"), "hi\n");
  run("git", ["add", "-A"]);
  run("git", ["commit", "-qm", "work"]);
  const sha = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const actor = (id, role) => ({ id, provider: "ci", role });
  evidence("implementation.json", { gitSha: sha, summary: "work", actor: actor("impl", "implementer") });

  expectKind("after implementation", runId, "validate");
  node("check.mjs", [runId, "ok"]);
  expectKind("after passing check", runId, "review");

  evidence("review.json", { gitSha: sha, summary: "self", actor: actor("impl", "reviewer"), findings: [] });
  const selfReview = expectKind("self-review", runId, "review");
  check(/independent/i.test(selfReview.reason), "lifecycle: self-review rejection must explain independence");

  evidence("review.json", {
    gitSha: sha,
    summary: "found blocker",
    actor: actor("reviewer", "reviewer"),
    findings: [{ severity: "major", title: "bug", detail: "fix it" }],
  });
  expectKind("blocking finding", runId, "fix");

  evidence("review.json", { gitSha: sha, summary: "clean", actor: actor("reviewer", "reviewer"), findings: [] });
  expectKind("clean review", runId, "verify");

  evidence("verification.json", {
    gitSha: sha,
    summary: "claims pass",
    actor: actor("verifier", "verifier"),
    passed: true,
    criteria: [{ id: "criterion-1", passed: false, evidence: "it failed" }],
  });
  expectKind("dishonest coverage", runId, "verify");

  evidence("verification.json", {
    gitSha: sha,
    summary: "verified",
    actor: actor("verifier", "verifier"),
    passed: true,
    criteria: [{ id: "criterion-1", passed: true, evidence: "cat app.txt prints hi" }],
  });
  expectKind("honest verification", runId, "stop");

  writeFileSync(join(temp, "app.txt"), "drift\n");
  run("git", ["add", "-A"]);
  run("git", ["commit", "-qm", "drift"]);
  expectKind("post-stop drift", runId, "implement");
} catch (error) {
  check(false, `lifecycle: ${error.message}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("Bones skill validation failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Validated ${expected.length} skills and the full directive-loop lifecycle.`);
