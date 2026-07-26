import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { Data, Effect, Schema } from "effect";
import {
  nextDirective,
  replayWorkflow,
  type WorkflowDirective,
  type WorkflowEvent,
  type WorkflowState,
} from "../domain/workflow.js";
import { hashJson, hashText, readJsonFile } from "../platform/json.js";
import { runProcess, type ProcessResult } from "../platform/process-runner.js";
import {
  appendWorkflowEvent,
  listRunIds,
  loadWorkflowEvents,
} from "../storage/event-store.js";
import { loadProjectContext, type ProjectContext } from "./project.js";

const ActorPayloadSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  provider: Schema.NonEmptyString,
  model: Schema.optional(Schema.NonEmptyString),
  role: Schema.optional(Schema.NonEmptyString),
});

const ReviewFindingPayloadSchema = Schema.Struct({
  severity: Schema.Literal("critical", "major", "minor", "suggestion"),
  title: Schema.NonEmptyString,
  detail: Schema.NonEmptyString,
  file: Schema.optional(Schema.NonEmptyString),
  line: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
});

const CriterionEvidencePayloadSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  passed: Schema.Boolean,
  evidence: Schema.NonEmptyString,
});

const CodePayloadSchema = Schema.Struct({
  gitSha: Schema.NonEmptyString,
  summary: Schema.String,
  actor: ActorPayloadSchema,
});

const ReviewPayloadSchema = Schema.Struct({
  gitSha: Schema.NonEmptyString,
  summary: Schema.String,
  actor: ActorPayloadSchema,
  findings: Schema.Array(ReviewFindingPayloadSchema),
});

const VerificationPayloadSchema = Schema.Struct({
  gitSha: Schema.NonEmptyString,
  summary: Schema.String,
  actor: ActorPayloadSchema,
  passed: Schema.Boolean,
  criteria: Schema.Array(CriterionEvidencePayloadSchema),
});

export interface RunSnapshot {
  readonly state: WorkflowState;
  readonly observedGitSha: string;
  readonly directive: WorkflowDirective;
}

export class WorkflowApplicationError extends Data.TaggedError("WorkflowApplicationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function currentTimestamp(): Effect.Effect<string> {
  return Effect.map(Effect.clock, (clock) => new Date(clock.unsafeCurrentTimeMillis()).toISOString());
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function resolveProjectFile(
  root: string,
  input: string,
  label: string
): Effect.Effect<string, WorkflowApplicationError> {
  return Effect.tryPromise({
    try: async () => {
      const resolvedRoot = path.resolve(root);
      const resolvedFile = path.resolve(resolvedRoot, input);
      if (!isPathWithinRoot(resolvedRoot, resolvedFile)) {
        throw new Error(`${label} must be inside the Bones project root.`);
      }
      const [realRoot, realFile] = await Promise.all([realpath(resolvedRoot), realpath(resolvedFile)]);
      if (!isPathWithinRoot(realRoot, realFile)) {
        throw new Error(`${label} resolves outside the Bones project root.`);
      }
      return resolvedFile;
    },
    catch: (cause) =>
      new WorkflowApplicationError({ message: `Could not resolve ${label.toLowerCase()}.`, cause }),
  });
}

function gitHead(root: string): Effect.Effect<string, WorkflowApplicationError> {
  return Effect.flatMap(
    runProcess({ argv: ["git", "rev-parse", "HEAD"], cwd: root, timeoutMs: 30_000 }),
    (result) =>
      result.exitCode === 0 && result.stdout.trim()
        ? Effect.succeed(result.stdout.trim())
        : Effect.fail(
            new WorkflowApplicationError({
              message: `Could not resolve Git HEAD: ${result.stderr.trim() || "git exited non-zero"}`,
            })
          )
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof WorkflowApplicationError
        ? cause
        : new WorkflowApplicationError({ message: "Could not inspect the Git repository.", cause })
    )
  );
}

function loadState(
  context: ProjectContext,
  runId: string
): Effect.Effect<WorkflowState, WorkflowApplicationError> {
  return Effect.flatMap(
    loadWorkflowEvents(context.stateHome, context.project.projectId, runId),
    (events) =>
      events.length > 0
        ? Effect.try({
            try: () => replayWorkflow(events),
            catch: (cause) =>
              new WorkflowApplicationError({ message: `Bones run ${runId} is invalid.`, cause }),
          })
        : Effect.fail(new WorkflowApplicationError({ message: `Bones run ${runId} was not found.` }))
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof WorkflowApplicationError
        ? cause
        : new WorkflowApplicationError({ message: `Could not load Bones run ${runId}.`, cause })
    )
  );
}

export function startRun(
  startDirectory: string,
  request: string
): Effect.Effect<RunSnapshot, WorkflowApplicationError> {
  return Effect.gen(function* () {
    const context = yield* loadProjectContext(startDirectory).pipe(
      Effect.mapError((cause) => new WorkflowApplicationError({ message: cause.message, cause }))
    );
    if (context.workflow.validation.checks.length === 0) {
      return yield* new WorkflowApplicationError({
        message:
          "No validation checks are configured. Add at least one check to .bones/workflow.json before starting a run.",
      });
    }
    const taskContent = request.trim();
    if (!taskContent) {
      return yield* new WorkflowApplicationError({ message: "The inline task request is empty." });
    }

    const baseSha = yield* gitHead(context.root);
    const at = yield* currentTimestamp();
    const runId = randomUUID();
    const event: WorkflowEvent = {
      _tag: "RunCreated",
      runId,
      projectId: context.project.projectId,
      projectRoot: context.root,
      task: {
        source: "inline-request",
        content: taskContent,
        digest: hashText(taskContent),
      },
      baseSha,
      validationChecks: context.workflow.validation.checks,
      reviewPolicy: context.workflow.review,
      verificationPolicy: context.workflow.verification,
      configDigest: hashJson(context.workflow),
      at,
    };
    yield* appendWorkflowEvent({
      stateHome: context.stateHome,
      projectId: context.project.projectId,
      runId,
      expectedRevision: 0,
      idempotencyKey: `start:${context.project.projectId}:${event.task.digest}:${baseSha}`,
      event,
    }).pipe(
      Effect.mapError((cause) =>
        new WorkflowApplicationError({ message: "Could not persist the new Bones run.", cause })
      )
    );
    return yield* getRunSnapshot(context.root, runId);
  });
}

export function getRunSnapshot(
  startDirectory: string,
  runId: string
): Effect.Effect<RunSnapshot, WorkflowApplicationError> {
  return Effect.gen(function* () {
    const context = yield* loadProjectContext(startDirectory).pipe(
      Effect.mapError((cause) => new WorkflowApplicationError({ message: cause.message, cause }))
    );
    const [state, observedGitSha] = yield* Effect.all([
      loadState(context, runId),
      gitHead(context.root),
    ]);
    return {
      state,
      observedGitSha,
      directive: nextDirective(state, observedGitSha),
    };
  });
}

export function listRuns(
  startDirectory: string
): Effect.Effect<ReadonlyArray<RunSnapshot>, WorkflowApplicationError> {
  return Effect.gen(function* () {
    const context = yield* loadProjectContext(startDirectory).pipe(
      Effect.mapError((cause) => new WorkflowApplicationError({ message: cause.message, cause }))
    );
    const ids = yield* listRunIds(context.stateHome, context.project.projectId).pipe(
      Effect.mapError((cause) => new WorkflowApplicationError({ message: cause.message, cause }))
    );
    return yield* Effect.forEach(ids, (runId) => getRunSnapshot(context.root, runId), {
      concurrency: 4,
    });
  });
}

function assertDirective(snapshot: RunSnapshot, directiveId: string): Effect.Effect<void, WorkflowApplicationError> {
  return snapshot.directive.id === directiveId
    ? Effect.void
    : Effect.fail(
        new WorkflowApplicationError({
          message: `Directive ${directiveId} is stale. Run bones next again; current directive is ${snapshot.directive.id}.`,
        })
      );
}

export function submitDirective(options: {
  readonly startDirectory: string;
  readonly runId: string;
  readonly directiveId: string;
  readonly payloadFile: string;
}): Effect.Effect<RunSnapshot, WorkflowApplicationError> {
  return Effect.gen(function* () {
    const context = yield* loadProjectContext(options.startDirectory).pipe(
      Effect.mapError((cause) => new WorkflowApplicationError({ message: cause.message, cause }))
    );
    const snapshot = yield* getRunSnapshot(context.root, options.runId);
    yield* assertDirective(snapshot, options.directiveId);
    const payloadPath = yield* resolveProjectFile(context.root, options.payloadFile, "Payload file");
    const raw = yield* Effect.tryPromise({
      try: () => readJsonFile(payloadPath),
      catch: (cause) =>
        new WorkflowApplicationError({ message: `Could not read payload ${payloadPath}.`, cause }),
    });
    const at = yield* currentTimestamp();
    let event: WorkflowEvent;

    if (snapshot.directive.kind === "implement" || snapshot.directive.kind === "fix") {
      const payload = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(CodePayloadSchema)(raw),
        catch: (cause) => new WorkflowApplicationError({ message: "Invalid code payload.", cause }),
      });
      if (payload.gitSha !== snapshot.observedGitSha) {
        return yield* new WorkflowApplicationError({
          message: `Code payload SHA ${payload.gitSha} does not match repository HEAD ${snapshot.observedGitSha}.`,
        });
      }
      event = { _tag: "CodeSubmitted", ...payload, at };
    } else if (snapshot.directive.kind === "review") {
      const payload = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(ReviewPayloadSchema)(raw),
        catch: (cause) => new WorkflowApplicationError({ message: "Invalid review payload.", cause }),
      });
      if (payload.gitSha !== snapshot.state.code?.gitSha) {
        return yield* new WorkflowApplicationError({
          message: "Review evidence must target the currently validated Git SHA.",
        });
      }
      if (
        snapshot.state.run.reviewPolicy.requireIndependentActor &&
        payload.actor.id === snapshot.state.code.actor.id
      ) {
        return yield* new WorkflowApplicationError({
          message: "The implementer cannot approve its own work under the independent-review policy.",
        });
      }
      const blockingSeverities = new Set(snapshot.state.run.reviewPolicy.blockingSeverities);
      event = {
        _tag: "ReviewRecorded",
        ...payload,
        blockingFindings: payload.findings.filter((finding) =>
          blockingSeverities.has(finding.severity)
        ).length,
        at,
      };
    } else if (snapshot.directive.kind === "verify") {
      const payload = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(VerificationPayloadSchema)(raw),
        catch: (cause) => new WorkflowApplicationError({ message: "Invalid verification payload.", cause }),
      });
      if (payload.gitSha !== snapshot.state.code?.gitSha) {
        return yield* new WorkflowApplicationError({
          message: "Verification evidence must target the currently reviewed Git SHA.",
        });
      }
      if (
        payload.passed &&
        snapshot.state.run.verificationPolicy.requireCriterionCoverage &&
        (payload.criteria.length === 0 || payload.criteria.some((criterion) => !criterion.passed))
      ) {
        return yield* new WorkflowApplicationError({
          message:
            "Passing verification requires explicit, passing evidence for every acceptance criterion.",
        });
      }
      if (payload.passed && snapshot.state.run.verificationPolicy.requireCleanWorktree) {
        const worktree = yield* runProcess({
          argv: ["git", "status", "--porcelain"],
          cwd: context.root,
          timeoutMs: 30_000,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new WorkflowApplicationError({
                message: "Could not inspect the Git worktree.",
                cause,
              })
          )
        );
        if (worktree.exitCode !== 0 || worktree.stdout.trim()) {
          return yield* new WorkflowApplicationError({
            message: "Passing verification requires a clean Git worktree.",
          });
        }
      }
      event = { _tag: "VerificationRecorded", ...payload, at };
    } else {
      return yield* new WorkflowApplicationError({
        message: `Directive ${snapshot.directive.kind} cannot be completed with bones submit.`,
      });
    }

    yield* appendWorkflowEvent({
      stateHome: context.stateHome,
      projectId: context.project.projectId,
      runId: options.runId,
      expectedRevision: snapshot.state.revision,
      idempotencyKey: `submit:${options.directiveId}:${hashJson(raw)}`,
      event,
    }).pipe(
      Effect.mapError((cause) =>
        new WorkflowApplicationError({ message: "Could not record directive evidence.", cause })
      )
    );
    return yield* getRunSnapshot(context.root, options.runId);
  });
}

function findCheck(state: WorkflowState, checkId: string) {
  return state.run.validationChecks.find((check) => check.id === checkId);
}

export function executeValidationCheck(options: {
  readonly startDirectory: string;
  readonly runId: string;
  readonly directiveId: string;
  readonly checkId: string;
}): Effect.Effect<{ readonly result: ProcessResult; readonly snapshot: RunSnapshot }, WorkflowApplicationError> {
  return Effect.gen(function* () {
    const context = yield* loadProjectContext(options.startDirectory).pipe(
      Effect.mapError((cause) => new WorkflowApplicationError({ message: cause.message, cause }))
    );
    const snapshot = yield* getRunSnapshot(context.root, options.runId);
    yield* assertDirective(snapshot, options.directiveId);
    if (snapshot.directive.kind !== "validate") {
      return yield* new WorkflowApplicationError({ message: "The current directive is not validation." });
    }
    if (!snapshot.directive.requiredChecks?.includes(options.checkId)) {
      return yield* new WorkflowApplicationError({
        message: `Check ${options.checkId} is not pending for this directive.`,
      });
    }
    const check = findCheck(snapshot.state, options.checkId);
    if (!check || check.argv.length === 0) {
      return yield* new WorkflowApplicationError({
        message: `Validation check ${options.checkId} is missing or has no argv.`,
      });
    }
    if (snapshot.observedGitSha !== snapshot.state.code?.gitSha) {
      return yield* new WorkflowApplicationError({
        message: "Repository HEAD changed. Submit the new Git SHA before validation.",
      });
    }
    const [command, ...args] = check.argv;
    if (!command) {
      return yield* new WorkflowApplicationError({ message: `Check ${check.id} has no executable.` });
    }
    const result = yield* runProcess({
      argv: [command, ...args],
      cwd: context.root,
      timeoutMs: check.timeoutMs,
    }).pipe(
      Effect.mapError((cause) =>
        new WorkflowApplicationError({ message: `Could not execute check ${check.id}.`, cause })
      )
    );
    const at = yield* currentTimestamp();
    const event: WorkflowEvent = {
      _tag: "CheckRecorded",
      gitSha: snapshot.state.code.gitSha,
      checkId: check.id,
      argv: check.argv,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdoutDigest: result.stdoutDigest,
      stderrDigest: result.stderrDigest,
      at,
    };
    yield* appendWorkflowEvent({
      stateHome: context.stateHome,
      projectId: context.project.projectId,
      runId: options.runId,
      expectedRevision: snapshot.state.revision,
      idempotencyKey: `exec:${options.directiveId}:${check.id}:${snapshot.state.code.gitSha}`,
      event,
    }).pipe(
      Effect.mapError((cause) =>
        new WorkflowApplicationError({ message: `Could not record check ${check.id}.`, cause })
      )
    );
    return { result, snapshot: yield* getRunSnapshot(context.root, options.runId) };
  });
}
