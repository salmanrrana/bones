import { Schema } from "effect";

export const ValidationCheckSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  argv: Schema.Array(Schema.NonEmptyString),
  timeoutMs: Schema.Number.pipe(Schema.int(), Schema.positive()),
});

export type ValidationCheck = Schema.Schema.Type<typeof ValidationCheckSchema>;

export const WorkflowConfigSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  validation: Schema.Struct({
    checks: Schema.Array(ValidationCheckSchema),
  }),
  review: Schema.Struct({
    requireIndependentActor: Schema.Boolean,
    blockingSeverities: Schema.Array(
      Schema.Literal("critical", "major", "minor", "suggestion")
    ),
  }),
  verification: Schema.Struct({
    requireCleanWorktree: Schema.Boolean,
    requireCriterionCoverage: Schema.Boolean,
  }),
});

export type WorkflowConfig = Schema.Schema.Type<typeof WorkflowConfigSchema>;

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  schemaVersion: 1,
  validation: { checks: [] },
  review: {
    requireIndependentActor: true,
    blockingSeverities: ["critical", "major"],
  },
  verification: {
    requireCleanWorktree: true,
    requireCriterionCoverage: true,
  },
};

export function decodeWorkflowConfig(input: unknown): WorkflowConfig {
  const config = Schema.decodeUnknownSync(WorkflowConfigSchema)(input);
  const ids = new Set<string>();
  for (const check of config.validation.checks) {
    if (check.argv.length === 0) {
      throw new Error(`Validation check ${check.id} must define at least one argv item.`);
    }
    if (ids.has(check.id)) {
      throw new Error(`Validation check ID ${check.id} is duplicated.`);
    }
    ids.add(check.id);
  }
  return config;
}
