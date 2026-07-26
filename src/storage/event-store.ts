import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Data, Effect, Schema } from "effect";
import { decodeWorkflowEvent, WorkflowEventSchema, type WorkflowEvent } from "../domain/workflow.js";
import { hashJson } from "../platform/json.js";

const StoredEventSchema = Schema.Struct({
  revision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  eventId: Schema.NonEmptyString,
  idempotencyKey: Schema.NonEmptyString,
  previousHash: Schema.NullOr(Schema.NonEmptyString),
  hash: Schema.NonEmptyString,
  event: WorkflowEventSchema,
});

export type StoredEvent = Schema.Schema.Type<typeof StoredEventSchema>;

export class EventStoreError extends Data.TaggedError("EventStoreError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class RevisionConflict extends Data.TaggedError("RevisionConflict")<{
  readonly expected: number;
  readonly actual: number;
}> {}

const LOCK_STALE_MS = 60_000;

function eventsDirectory(stateHome: string, projectId: string, runId: string): string {
  return path.join(stateHome, "projects", projectId, "runs", runId, "events");
}

function storedEventHash(input: Omit<StoredEvent, "hash">): string {
  return hashJson(input);
}

function decodeStoredEvent(input: unknown): StoredEvent {
  return Schema.decodeUnknownSync(StoredEventSchema)(input);
}

async function loadStoredEventsUnsafe(
  stateHome: string,
  projectId: string,
  runId: string
): Promise<StoredEvent[]> {
  const directory = eventsDirectory(stateHome, projectId, runId);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => /^\d{10}\.json$/.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const stored: StoredEvent[] = [];
  let previousHash: string | null = null;
  for (const [index, name] of names.entries()) {
    const raw = JSON.parse(await readFile(path.join(directory, name), "utf8")) as unknown;
    const item = decodeStoredEvent(raw);
    const expectedRevision = index + 1;
    if (item.revision !== expectedRevision) {
      throw new Error(`Event revision ${item.revision} is out of sequence; expected ${expectedRevision}.`);
    }
    if (item.previousHash !== previousHash) {
      throw new Error(`Event ${item.revision} has an invalid previous hash.`);
    }
    const { hash, ...hashInput } = item;
    if (storedEventHash(hashInput) !== hash) {
      throw new Error(`Event ${item.revision} failed its integrity check.`);
    }
    stored.push(item);
    previousHash = hash;
  }
  return stored;
}

async function acquireRunLock(directory: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(path.dirname(directory), ".append.lock");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
          "utf8"
        );
        await handle.sync();
      } catch (error) {
        await rm(lockPath, { force: true });
        throw error;
      } finally {
        await handle.close();
      }
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "EEXIST") throw error;
      let lockStat;
      try {
        lockStat = await stat(lockPath);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() - lockStat.mtimeMs <= LOCK_STALE_MS) {
        throw new Error("Another Bones process is appending to this run.");
      }
      const stalePath = `${lockPath}.stale.${randomUUID()}`;
      await rename(lockPath, stalePath).catch(() => undefined);
      await rm(stalePath, { force: true });
    }
  }
  throw new Error("Could not acquire the Bones run lock.");
}

export function loadStoredEvents(
  stateHome: string,
  projectId: string,
  runId: string
): Effect.Effect<ReadonlyArray<StoredEvent>, EventStoreError> {
  return Effect.tryPromise({
    try: () => loadStoredEventsUnsafe(stateHome, projectId, runId),
    catch: (cause) =>
      new EventStoreError({ message: `Could not load Bones run ${runId}.`, cause }),
  });
}

export function loadWorkflowEvents(
  stateHome: string,
  projectId: string,
  runId: string
): Effect.Effect<ReadonlyArray<WorkflowEvent>, EventStoreError> {
  return Effect.map(loadStoredEvents(stateHome, projectId, runId), (stored) =>
    stored.map((item) => decodeWorkflowEvent(item.event))
  );
}

export function appendWorkflowEvent(options: {
  readonly stateHome: string;
  readonly projectId: string;
  readonly runId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly event: WorkflowEvent;
}): Effect.Effect<StoredEvent, EventStoreError | RevisionConflict> {
  return Effect.tryPromise({
    try: async () => {
      const directory = eventsDirectory(options.stateHome, options.projectId, options.runId);
      const release = await acquireRunLock(directory);
      try {
        const existing = await loadStoredEventsUnsafe(
          options.stateHome,
          options.projectId,
          options.runId
        );
        const duplicate = existing.find((item) => item.idempotencyKey === options.idempotencyKey);
        if (duplicate) return duplicate;
        if (existing.length !== options.expectedRevision) {
          throw new RevisionConflict({ expected: options.expectedRevision, actual: existing.length });
        }

        const revision = existing.length + 1;
        const withoutHash = {
          revision,
          eventId: randomUUID(),
          idempotencyKey: options.idempotencyKey,
          previousHash: existing.at(-1)?.hash ?? null,
          event: options.event,
        };
        const stored: StoredEvent = {
          ...withoutHash,
          hash: storedEventHash(withoutHash),
        };

        const finalPath = path.join(directory, `${String(revision).padStart(10, "0")}.json`);
        const temporaryPath = path.join(directory, `.${revision}.${randomUUID()}.tmp`);
        const handle = await open(temporaryPath, "wx");
        try {
          await handle.writeFile(`${JSON.stringify(stored, null, 2)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          await rename(temporaryPath, finalPath);
        } catch (error) {
          await rm(temporaryPath, { force: true });
          throw error;
        }
        return stored;
      } finally {
        await release();
      }
    },
    catch: (cause) => {
      if (cause instanceof RevisionConflict) return cause;
      return new EventStoreError({ message: `Could not append to Bones run ${options.runId}.`, cause });
    },
  });
}

export function listRunIds(
  stateHome: string,
  projectId: string
): Effect.Effect<ReadonlyArray<string>, EventStoreError> {
  const runsDirectory = path.join(stateHome, "projects", projectId, "runs");
  return Effect.tryPromise({
    try: async () => {
      try {
        const entries = await readdir(runsDirectory, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    catch: (cause) => new EventStoreError({ message: "Could not list Bones runs.", cause }),
  });
}
