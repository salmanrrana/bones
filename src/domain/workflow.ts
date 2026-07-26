import { Schema } from "effect";
import { ValidationCheckSchema } from "./config.js";

const ActorSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  provider: Schema.NonEmptyString,
  model: Schema.optional(Schema.NonEmptyString),
  role: Schema.optional(Schema.NonEmptyString),
});

const SeveritySchema = Schema.Literal("critical", "major", "minor", "suggestion");

const ReviewFindingSchema = Schema.Struct({
  severity: SeveritySchema,
  title: Schema.NonEmptyString,
  detail: Schema.NonEmptyString,
  file: Schema.optional(Schema.NonEmptyString),
  line: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
});

const CriterionEvidenceSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  passed: Schema.Boolean,
  evidence: Schema.NonEmptyString,
});

const TaskSchema = Schema.Struct({
  source: Schema.NonEmptyString,
  content: Schema.NonEmptyString,
  digest: Schema.NonEmptyString,
});

export const RunCreatedSchema = Schema.TaggedStruct("RunCreated", {
  runId: Schema.NonEmptyString,
  projectId: Schema.NonEmptyString,
  projectRoot: Schema.NonEmptyString,
  task: TaskSchema,
  baseSha: Schema.NonEmptyString,
  validationChecks: Schema.Array(ValidationCheckSchema),
  reviewPolicy: Schema.Struct({
    requireIndependentActor: Schema.Boolean,
    blockingSeverities: Schema.Array(SeveritySchema),
  }),
  verificationPolicy: Schema.Struct({
    requireCleanWorktree: Schema.Boolean,
    requireCriterionCoverage: Schema.Boolean,
  }),
  configDigest: Schema.NonEmptyString,
  at: Schema.NonEmptyString,
});

export const CodeSubmittedSchema = Schema.TaggedStruct("CodeSubmitted", {
  gitSha: Schema.NonEmptyString,
  summary: Schema.String,
  actor: ActorSchema,
  at: Schema.NonEmptyString,
});

export const CheckRecordedSchema = Schema.TaggedStruct("CheckRecorded", {
  gitSha: Schema.NonEmptyString,
  checkId: Schema.NonEmptyString,
  argv: Schema.Array(Schema.NonEmptyString),
  exitCode: Schema.Number.pipe(Schema.int()),
  durationMs: Schema.Number.pipe(Schema.nonNegative()),
  stdoutDigest: Schema.NonEmptyString,
  stderrDigest: Schema.NonEmptyString,
  at: Schema.NonEmptyString,
});

export const ReviewRecordedSchema = Schema.TaggedStruct("ReviewRecorded", {
  gitSha: Schema.NonEmptyString,
  actor: ActorSchema,
  findings: Schema.Array(ReviewFindingSchema),
  blockingFindings: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  summary: Schema.String,
  at: Schema.NonEmptyString,
});

export const VerificationRecordedSchema = Schema.TaggedStruct("VerificationRecorded", {
  gitSha: Schema.NonEmptyString,
  actor: ActorSchema,
  passed: Schema.Boolean,
  summary: Schema.String,
  criteria: Schema.Array(CriterionEvidenceSchema),
  at: Schema.NonEmptyString,
});

export const WorkflowEventSchema = Schema.Union(
  RunCreatedSchema,
  CodeSubmittedSchema,
  CheckRecordedSchema,
  ReviewRecordedSchema,
  VerificationRecordedSchema
);

export type WorkflowEvent = Schema.Schema.Type<typeof WorkflowEventSchema>;
export type RunCreated = Schema.Schema.Type<typeof RunCreatedSchema>;
export type CodeSubmitted = Schema.Schema.Type<typeof CodeSubmittedSchema>;
export type CheckRecorded = Schema.Schema.Type<typeof CheckRecordedSchema>;
export type ReviewRecorded = Schema.Schema.Type<typeof ReviewRecordedSchema>;
export type VerificationRecorded = Schema.Schema.Type<typeof VerificationRecordedSchema>;

export interface WorkflowState {
  readonly revision: number;
  readonly run: RunCreated;
  readonly code: CodeSubmitted | null;
  readonly checks: ReadonlyArray<CheckRecorded>;
  readonly review: ReviewRecorded | null;
  readonly verification: VerificationRecorded | null;
}

export type DirectiveKind =
  | "configure"
  | "implement"
  | "validate"
  | "review"
  | "fix"
  | "verify"
  | "stop";

export interface WorkflowDirective {
  readonly id: string;
  readonly kind: DirectiveKind;
  readonly runId: string;
  readonly revision: number;
  readonly reason: string;
  readonly gitSha: string | null;
  readonly requiredChecks?: ReadonlyArray<string>;
}

export function decodeWorkflowEvent(input: unknown): WorkflowEvent {
  return Schema.decodeUnknownSync(WorkflowEventSchema)(input);
}

export function replayWorkflow(events: ReadonlyArray<WorkflowEvent>): WorkflowState {
  const first = events[0];
  if (!first || first._tag !== "RunCreated") {
    throw new Error("A Bones run must begin with RunCreated.");
  }

  let state: WorkflowState = {
    revision: 1,
    run: first,
    code: null,
    checks: [],
    review: null,
    verification: null,
  };

  for (const event of events.slice(1)) {
    state = evolveWorkflow(state, event);
  }
  return state;
}

export function evolveWorkflow(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  if (event._tag === "RunCreated") {
    throw new Error("RunCreated may only be the first event.");
  }

  const revision = state.revision + 1;
  switch (event._tag) {
    case "CodeSubmitted":
      return {
        ...state,
        revision,
        code: event,
      };
    case "CheckRecorded":
      return {
        ...state,
        revision,
        checks: [...state.checks, event],
      };
    case "ReviewRecorded":
      return {
        ...state,
        revision,
        review: event,
      };
    case "VerificationRecorded":
      return {
        ...state,
        revision,
        verification: event,
      };
  }
}

function makeDirective(
  state: WorkflowState,
  kind: DirectiveKind,
  reason: string,
  gitSha: string | null = state.code?.gitSha ?? null,
  requiredChecks?: ReadonlyArray<string>
): WorkflowDirective {
  return {
    id: `${state.revision}:${kind}:${gitSha ?? "none"}`,
    kind,
    runId: state.run.runId,
    revision: state.revision,
    reason,
    gitSha,
    ...(requiredChecks ? { requiredChecks } : {}),
  };
}

export function nextDirective(
  state: WorkflowState,
  observedGitSha: string | null = state.code?.gitSha ?? state.run.baseSha
): WorkflowDirective {
  if (state.run.validationChecks.length === 0) {
    return makeDirective(
      state,
      "configure",
      "No validation checks are configured. Add at least one check to .bones/workflow.json."
    );
  }

  if (!state.code) {
    return makeDirective(state, "implement", "Implement the task, commit it, and submit the Git SHA.");
  }

  if (observedGitSha && observedGitSha !== state.code.gitSha) {
    return makeDirective(
      state,
      "implement",
      "Repository HEAD changed after the last code submission. Submit the new Git SHA before continuing.",
      observedGitSha
    );
  }

  const checksForSha = state.checks.filter((check) => check.gitSha === state.code?.gitSha);
  const latestCheckById = new Map<string, CheckRecorded>();
  for (const check of checksForSha) latestCheckById.set(check.checkId, check);

  const pendingChecks = state.run.validationChecks
    .map((check) => check.id)
    .filter((checkId) => latestCheckById.get(checkId)?.exitCode !== 0);
  if (pendingChecks.length > 0) {
    return makeDirective(
      state,
      "validate",
      "Run every required validation check through Bones.",
      state.code.gitSha,
      pendingChecks
    );
  }

  const review = state.review?.gitSha === state.code.gitSha ? state.review : null;
  if (!review) {
    return makeDirective(state, "review", "Review the exact validated Git SHA.");
  }
  if (
    state.run.reviewPolicy.requireIndependentActor &&
    review.actor.id === state.code.actor.id
  ) {
    return makeDirective(
      state,
      "review",
      "An independent actor must review this run; the implementer cannot approve its own work."
    );
  }
  if (review.blockingFindings > 0) {
    return makeDirective(
      state,
      "fix",
      `${review.blockingFindings} blocking review finding(s) must be fixed in a new commit.`
    );
  }

  const verification =
    state.verification?.gitSha === state.code.gitSha ? state.verification : null;
  if (!verification) {
    return makeDirective(state, "verify", "Verify the reviewed Git SHA in a clean environment.");
  }
  if (!verification.passed) {
    return makeDirective(state, "fix", "Verification failed. Fix the cause in a new commit.");
  }

  return makeDirective(state, "stop", "All quality gates passed for this Git SHA.");
}
