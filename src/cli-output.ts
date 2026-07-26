import { Effect } from "effect";

function errorRecord(error: unknown): Record<string, unknown> {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { _tag?: unknown; message?: unknown; cause?: unknown };
    return {
      error: typeof candidate._tag === "string" ? candidate._tag : "BonesError",
      message:
        typeof candidate.message === "string" ? candidate.message : "Bones command failed.",
      ...(candidate.cause instanceof Error ? { cause: candidate.cause.message } : {}),
    };
  }
  return { error: "BonesError", message: String(error) };
}

export function emitResult(
  data: unknown,
  json: boolean,
  human: (value: typeof data) => string
): Effect.Effect<void> {
  return Effect.sync(() => {
    console.log(json ? JSON.stringify(data, null, 2) : human(data));
  });
}

export function handleCommand<E>(
  json: boolean,
  effect: Effect.Effect<void, E>
): Effect.Effect<void> {
  return effect.pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        const record = errorRecord(error);
        console.error(json ? JSON.stringify(record, null, 2) : `Error: ${String(record.message)}`);
        process.exitCode = 1;
      })
    )
  );
}
