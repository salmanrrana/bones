import { Schema } from "effect";

export const ProjectConfigSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  projectId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  createdAt: Schema.NonEmptyString,
});

export type ProjectConfig = Schema.Schema.Type<typeof ProjectConfigSchema>;

export function decodeProjectConfig(input: unknown): ProjectConfig {
  return Schema.decodeUnknownSync(ProjectConfigSchema)(input);
}
