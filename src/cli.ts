#!/usr/bin/env node

import { Args, Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { runDoctor } from "./application/doctor.js";
import { initializeProject } from "./application/project.js";
import { installSkill } from "./application/skill.js";
import {
  executeValidationCheck,
  getRunSnapshot,
  listRuns,
  startRun,
  submitDirective,
  type RunSnapshot,
} from "./application/workflow.js";
import { emitResult, handleCommand } from "./cli-output.js";

const VERSION = "0.1.0";
const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit stable machine-readable JSON.")
);

function summarize(snapshot: RunSnapshot) {
  return {
    runId: snapshot.state.run.runId,
    revision: snapshot.state.revision,
    task: snapshot.state.run.task,
    baseSha: snapshot.state.run.baseSha,
    currentSha: snapshot.state.code?.gitSha ?? null,
    observedGitSha: snapshot.observedGitSha,
    directive: snapshot.directive,
    evidence: {
      checks: snapshot.state.checks,
      review: snapshot.state.review,
      verification: snapshot.state.verification,
    },
  };
}

const doctorCommand = Command.make("doctor", { json: jsonOption }, ({ json }) =>
  handleCommand(
    json,
    Effect.flatMap(runDoctor(), (report) =>
      Effect.zipRight(
        emitResult(report, json, () => {
          const status = report.healthy ? "healthy" : "unhealthy";
          return [
            `Bones is ${status}.`,
            `Platform: ${report.platform.value} (${report.platform.supported ? "supported" : "unsupported"})`,
            `Node: ${report.node.version} (${report.node.testedLts ? "CI-tested LTS" : "supported, not CI-tested"})`,
            `Git: ${report.git.version ?? "not available"}`,
            `State: ${report.state.path} (${report.state.writable ? "writable" : "not writable"})`,
          ].join("\n");
        }),
        Effect.sync(() => {
          if (!report.healthy) process.exitCode = 1;
        })
      )
    )
  )
).pipe(Command.withDescription("Check the Bones runtime and platform dependencies."));

const initCommand = Command.make("init", { json: jsonOption }, ({ json }) =>
  handleCommand(
    json,
    Effect.flatMap(initializeProject(process.cwd()), ({ context, alreadyInitialized }) => {
      const result = {
        project: context.project,
        root: context.root,
        stateHome: context.stateHome,
        workflow: context.workflow,
        alreadyInitialized,
      };
      return emitResult(result, json, () =>
        `${alreadyInitialized ? "Loaded" : "Initialized"} Bones project ${context.project.name}.\n` +
        `Validation checks: ${context.workflow.validation.checks.map((check) => check.id).join(", ") || "none configured"}`
      );
    })
  )
).pipe(Command.withDescription("Initialize Bones in the current Git project."));

const userSkillOption = Options.boolean("user").pipe(
  Options.withDescription("Install under the current user's ~/.agents/skills directory.")
);
const forceSkillOption = Options.boolean("force").pipe(
  Options.withDescription("Overwrite an existing Bones skill installation.")
);
const skillInstallCommand = Command.make(
  "skill-install",
  { json: jsonOption, user: userSkillOption, force: forceSkillOption },
  ({ json, user, force }) =>
    handleCommand(
      json,
      Effect.flatMap(installSkill({ cwd: process.cwd(), user, force }), (result) =>
        emitResult(result, json, () =>
          result.alreadyInstalled
            ? `Bones skill already exists at ${result.target}. Use --force to update it.`
            : `Installed Bones skill at ${result.target}.`
        )
      )
    )
).pipe(Command.withDescription("Install the canonical Agent Skill for compatible AI providers."));

const requestOption = Options.text("request").pipe(
  Options.withDescription("Inline task, constraints, and acceptance criteria.")
);
const startCommand = Command.make(
  "start",
  { json: jsonOption, request: requestOption },
  ({ json, request }) =>
    handleCommand(
      json,
      Effect.flatMap(startRun(process.cwd(), request), (snapshot) => {
        const result = summarize(snapshot);
        return emitResult(
          result,
          json,
          () => `Started Bones run ${result.runId}.\nNext: ${result.directive.kind} — ${result.directive.reason}`
        );
      })
    )
).pipe(Command.withDescription("Create a run from an immutable inline request snapshot."));

const runIdArgument = Args.text({ name: "run-id" });
const statusCommand = Command.make(
  "status",
  { json: jsonOption, runId: runIdArgument },
  ({ json, runId }) =>
    handleCommand(
      json,
      Effect.flatMap(getRunSnapshot(process.cwd(), runId), (snapshot) => {
        const result = summarize(snapshot);
        return emitResult(
          result,
          json,
          () => `Run ${result.runId} at revision ${result.revision}.\nCurrent directive: ${result.directive.kind} — ${result.directive.reason}`
        );
      })
    )
).pipe(Command.withDescription("Show state and evidence for one run."));

const nextCommand = Command.make(
  "next",
  { json: jsonOption, runId: runIdArgument },
  ({ json, runId }) =>
    handleCommand(
      json,
      Effect.flatMap(getRunSnapshot(process.cwd(), runId), (snapshot) => {
        const result = {
          runId,
          task: snapshot.state.run.task,
          directive: snapshot.directive,
        };
        return emitResult(
          result,
          json,
          () => `${snapshot.directive.kind}: ${snapshot.directive.reason}\nDirective ID: ${snapshot.directive.id}`
        );
      })
    )
).pipe(Command.withDescription("Return the only currently valid workflow directive."));

const listCommand = Command.make("list", { json: jsonOption }, ({ json }) =>
  handleCommand(
    json,
    Effect.flatMap(listRuns(process.cwd()), (snapshots) => {
      const result = snapshots.map((snapshot) => summarize(snapshot));
      return emitResult(result, json, () =>
        result.length === 0
          ? "No Bones runs."
          : result
              .map(
                (item) =>
                  `${item.runId}  r${item.revision}  ${item.directive.kind}  ${item.task.source}`
              )
              .join("\n")
      );
    })
  )
).pipe(Command.withDescription("List runs for the current project."));

const directiveIdArgument = Args.text({ name: "directive-id" });
const payloadFileArgument = Args.text({ name: "payload-file" });
const submitCommand = Command.make(
  "submit",
  {
    json: jsonOption,
    runId: runIdArgument,
    directiveId: directiveIdArgument,
    payloadFile: payloadFileArgument,
  },
  ({ json, runId, directiveId, payloadFile }) =>
    handleCommand(
      json,
      Effect.flatMap(
        submitDirective({
          startDirectory: process.cwd(),
          runId,
          directiveId,
          payloadFile,
        }),
        (snapshot) => {
          const result = summarize(snapshot);
          return emitResult(
            result,
            json,
            () => `Recorded directive evidence.\nNext: ${result.directive.kind} — ${result.directive.reason}`
          );
        }
      )
    )
).pipe(Command.withDescription("Submit typed evidence for the current directive."));

const checkIdArgument = Args.text({ name: "check-id" });
const execCommand = Command.make(
  "exec",
  {
    json: jsonOption,
    runId: runIdArgument,
    directiveId: directiveIdArgument,
    checkId: checkIdArgument,
  },
  ({ json, runId, directiveId, checkId }) =>
    handleCommand(
      json,
      Effect.flatMap(
        executeValidationCheck({
          startDirectory: process.cwd(),
          runId,
          directiveId,
          checkId,
        }),
        ({ result, snapshot }) => {
          const output = {
            checkId,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stdout: result.stdout,
            stderr: result.stderr,
            truncated: result.truncated,
            next: snapshot.directive,
          };
          return emitResult(
            output,
            json,
            () =>
              `Check ${checkId} exited ${result.exitCode} in ${result.durationMs}ms.\n` +
              `Next: ${snapshot.directive.kind} — ${snapshot.directive.reason}`
          );
        }
      )
    )
).pipe(Command.withDescription("Execute and record a configured validation check."));

const rootCommand = Command.make("bones").pipe(
  Command.withDescription("Deterministic quality workflow for every AI coding provider."),
  Command.withSubcommands([
    doctorCommand,
    skillInstallCommand,
    initCommand,
    startCommand,
    statusCommand,
    nextCommand,
    listCommand,
    submitCommand,
    execCommand,
  ])
);

const cli = Command.run(rootCommand, {
  name: "Bones",
  version: VERSION,
});

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);
