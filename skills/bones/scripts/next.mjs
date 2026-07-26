// Compute the current directive for a run from recorded evidence and Git state.
// Usage: node next.mjs [run-id]
// With no run-id: lists runs, or resolves the only run automatically.

import { emit, fail, listRuns, loadRun, nextDirective, resolveRoot } from "./state.mjs";

const root = resolveRoot();
const runs = listRuns(root);
let runId = process.argv[2];

if (!runId) {
  if (runs.length === 0) {
    fail("no-runs", "No Bones runs exist in this project. Start one with start.mjs.");
  }
  if (runs.length > 1) {
    fail("ambiguous-run", "Multiple runs exist. Pass the run id explicitly.", { runs });
  }
  runId = runs[0];
}

if (!runs.includes(runId)) {
  fail("unknown-run", `No run named ${runId}.`, { runs });
}

const state = loadRun(root, runId);
emit(nextDirective(root, state));
