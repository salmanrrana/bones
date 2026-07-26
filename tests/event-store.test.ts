import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowEvent } from "../src/domain/workflow.js";
import {
  appendWorkflowEvent,
  loadStoredEvents,
} from "../src/storage/event-store.js";
import { hashJson } from "../src/platform/json.js";

const temporaryDirectories: string[] = [];

async function stateHome(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "bones-events-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function createdEvent(): WorkflowEvent {
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
    at: "2026-07-22T12:00:00.000Z",
  };
}

describe("event store", () => {
  it("hashes equivalent JSON independently of provider key order", () => {
    expect(hashJson({ provider: "one", nested: { b: 2, a: 1 } })).toBe(
      hashJson({ nested: { a: 1, b: 2 }, provider: "one" })
    );
  });

  it("appends a hash-chained event and makes retries idempotent", async () => {
    const home = await stateHome();
    const options = {
      stateHome: home,
      projectId: "project-1",
      runId: "run-1",
      expectedRevision: 0,
      idempotencyKey: "start-key",
      event: createdEvent(),
    };

    const first = await Effect.runPromise(appendWorkflowEvent(options));
    const retry = await Effect.runPromise(appendWorkflowEvent(options));
    const loaded = await Effect.runPromise(loadStoredEvents(home, "project-1", "run-1"));

    expect(first.revision).toBe(1);
    expect(retry.eventId).toBe(first.eventId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns a typed revision conflict for a competing append", async () => {
    const home = await stateHome();
    await Effect.runPromise(
      appendWorkflowEvent({
        stateHome: home,
        projectId: "project-1",
        runId: "run-1",
        expectedRevision: 0,
        idempotencyKey: "start-key",
        event: createdEvent(),
      })
    );

    const error = await Effect.runPromise(
      Effect.flip(
        appendWorkflowEvent({
          stateHome: home,
          projectId: "project-1",
          runId: "run-1",
          expectedRevision: 0,
          idempotencyKey: "different-key",
          event: createdEvent(),
        })
      )
    );
    expect(error).toMatchObject({ _tag: "RevisionConflict", expected: 0, actual: 1 });
  });

  it("detects event-file tampering", async () => {
    const home = await stateHome();
    await Effect.runPromise(
      appendWorkflowEvent({
        stateHome: home,
        projectId: "project-1",
        runId: "run-1",
        expectedRevision: 0,
        idempotencyKey: "start-key",
        event: createdEvent(),
      })
    );
    const eventPath = path.join(
      home,
      "projects",
      "project-1",
      "runs",
      "run-1",
      "events",
      "0000000001.json"
    );
    const stored = JSON.parse(await readFile(eventPath, "utf8")) as {
      event: { task: { content: string } };
    };
    stored.event.task.content = "silently changed";
    await writeFile(eventPath, JSON.stringify(stored), "utf8");

    const error = await Effect.runPromise(
      Effect.flip(loadStoredEvents(home, "project-1", "run-1"))
    );
    expect(error._tag).toBe("EventStoreError");
    expect(String(error.cause)).toContain("integrity check");
  });
});
