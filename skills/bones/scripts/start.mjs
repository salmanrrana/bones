// Start a Bones run: snapshot the request, base SHA, and workflow policy.
// Usage: node start.mjs --request "<work contract>"

import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  bonesDir,
  emit,
  ensureDir,
  fail,
  git,
  listRuns,
  loadPolicy,
  readJsonFile,
  resolveRoot,
  runDir,
  writeJsonFile,
} from "./state.mjs";

const args = process.argv.slice(2);
const requestIndex = args.indexOf("--request");
const request = requestIndex >= 0 ? args[requestIndex + 1] : undefined;
if (!request || request.trim().length === 0) {
  fail("missing-request", 'Usage: node start.mjs --request "<work contract>"');
}

const root = resolveRoot();
const policy = loadPolicy(root);
if (policy.validation.checks.length === 0) {
  fail(
    "no-checks",
    "workflow.json has zero validation checks. Add at least one check before starting a run."
  );
}

const projectPath = join(bonesDir(root), "project.json");
const project = readJsonFile(projectPath, "project identity");
if (!project) {
  fail(
    "missing-project",
    `No ${projectPath}. Follow the bones skill's init step to create project identity first.`
  );
}

const baseSha = git(root, ["rev-parse", "HEAD"]);
const existing = listRuns(root);
const sequence = String(existing.length + 1).padStart(3, "0");
const runId = `run-${sequence}-${baseSha.slice(0, 7)}`;
const dir = runDir(root, runId);
if (existsSync(dir)) fail("run-exists", `Run directory already exists: ${dir}`);

ensureDir(join(dir, "checks"));
writeJsonFile(join(dir, "run.json"), {
  schemaVersion: 2,
  runId,
  projectId: project.projectId,
  request: request.trim(),
  baseSha,
  policy,
  createdAt: new Date().toISOString(),
});

emit({
  runId,
  runDir: dir,
  baseSha,
  policy,
  next: `node ${join("skills", "bones", "scripts", "next.mjs")} ${runId}`,
});
