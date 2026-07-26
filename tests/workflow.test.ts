import { describe, expect, it } from "vitest";
import {
  evolveWorkflow,
  nextDirective,
  replayWorkflow,
  type RunCreated,
  type WorkflowEvent,
  type WorkflowState,
} from "../src/domain/workflow.js";

const at = "2026-07-22T12:00:00.000Z";

function runCreated(overrides: Partial<RunCreated> = {}): RunCreated {
  return {
    _tag: "RunCreated",
    runId: "run-1",
    projectId: "project-1",
    projectRoot: "/project",
    task: { source: "task.md", content: "Build it", digest: "task-digest" },
    baseSha: "base-sha",
    validationChecks: [{ id: "check", argv: ["pnpm", "check"], timeoutMs: 300_000 }],
    reviewPolicy: {
      requireIndependentActor: true,
      blockingSeverities: ["critical", "major"],
    },
    verificationPolicy: {
      requireCleanWorktree: true,
      requireCriterionCoverage: true,
    },
    configDigest: "config-digest",
    at,
    ...overrides,
  };
}

function apply(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  return evolveWorkflow(state, event);
}

describe("workflow directives", () => {
  it("requires configuration before work if a legacy or invalid run has no checks", () => {
    const state = replayWorkflow([runCreated({ validationChecks: [] })]);
    expect(nextDirective(state).kind).toBe("configure");
  });

  it("invalidates stale evidence and advances only after every gate", () => {
    let state = replayWorkflow([runCreated()]);
    expect(nextDirective(state).kind).toBe("implement");

    state = apply(state, {
      _tag: "CodeSubmitted",
      gitSha: "sha-a",
      summary: "implementation",
      actor: { id: "agent-a", provider: "openai", model: "codex" },
      at,
    });
    expect(nextDirective(state, "sha-a")).toMatchObject({
      kind: "validate",
      requiredChecks: ["check"],
    });

    state = apply(state, {
      _tag: "CheckRecorded",
      gitSha: "sha-a",
      checkId: "check",
      argv: ["pnpm", "check"],
      exitCode: 1,
      durationMs: 10,
      stdoutDigest: "stdout",
      stderrDigest: "stderr",
      at,
    });
    expect(nextDirective(state, "sha-a").kind).toBe("validate");

    state = apply(state, {
      _tag: "CheckRecorded",
      gitSha: "sha-a",
      checkId: "check",
      argv: ["pnpm", "check"],
      exitCode: 0,
      durationMs: 10,
      stdoutDigest: "stdout-2",
      stderrDigest: "stderr-2",
      at,
    });
    expect(nextDirective(state, "sha-a").kind).toBe("review");

    state = apply(state, {
      _tag: "ReviewRecorded",
      gitSha: "sha-a",
      actor: { id: "agent-b", provider: "anthropic" },
      findings: [],
      blockingFindings: 0,
      summary: "clean",
      at,
    });
    expect(nextDirective(state, "sha-a").kind).toBe("verify");

    state = apply(state, {
      _tag: "VerificationRecorded",
      gitSha: "sha-a",
      actor: { id: "agent-c", provider: "google" },
      passed: true,
      summary: "accepted",
      criteria: [{ id: "criterion-1", passed: true, evidence: "integration test" }],
      at,
    });
    expect(nextDirective(state, "sha-a").kind).toBe("stop");

    expect(nextDirective(state, "sha-b").kind).toBe("implement");

    state = apply(state, {
      _tag: "CodeSubmitted",
      gitSha: "sha-b",
      summary: "later change",
      actor: { id: "agent-a", provider: "openai" },
      at,
    });
    expect(nextDirective(state, "sha-b")).toMatchObject({
      kind: "validate",
      requiredChecks: ["check"],
    });
  });

  it("rejects self-review and routes blocking findings back to fixes", () => {
    const events: WorkflowEvent[] = [
      runCreated(),
      {
        _tag: "CodeSubmitted",
        gitSha: "sha-a",
        summary: "implementation",
        actor: { id: "same-agent", provider: "openai" },
        at,
      },
      {
        _tag: "CheckRecorded",
        gitSha: "sha-a",
        checkId: "check",
        argv: ["pnpm", "check"],
        exitCode: 0,
        durationMs: 10,
        stdoutDigest: "stdout",
        stderrDigest: "stderr",
        at,
      },
      {
        _tag: "ReviewRecorded",
        gitSha: "sha-a",
        actor: { id: "same-agent", provider: "openai" },
        findings: [],
        blockingFindings: 0,
        summary: "self review",
        at,
      },
    ];
    expect(nextDirective(replayWorkflow(events), "sha-a").kind).toBe("review");

    events.push({
      _tag: "ReviewRecorded",
      gitSha: "sha-a",
      actor: { id: "different-agent", provider: "anthropic" },
      findings: [{ severity: "major", title: "Bug", detail: "It breaks" }],
      blockingFindings: 1,
      summary: "one blocker",
      at,
    });
    expect(nextDirective(replayWorkflow(events), "sha-a").kind).toBe("fix");
  });
});
