import { randomUUID } from "node:crypto";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Data, Effect } from "effect";
import {
  DEFAULT_WORKFLOW_CONFIG,
  decodeWorkflowConfig,
  type ValidationCheck,
  type WorkflowConfig,
} from "../domain/config.js";
import { decodeProjectConfig, type ProjectConfig } from "../domain/project.js";
import { readJsonFile, writeJsonExclusive } from "../platform/json.js";
import { resolveStateHome } from "../platform/paths.js";

const PROJECT_DIRECTORY = ".bones";
const PROJECT_FILE = "project.json";
const WORKFLOW_FILE = "workflow.json";

export interface ProjectContext {
  readonly root: string;
  readonly stateHome: string;
  readonly project: ProjectConfig;
  readonly workflow: WorkflowConfig;
}

export class ProjectError extends Data.TaggedError("ProjectError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureBonesIgnored(root: string): Promise<void> {
  const ignorePath = path.join(root, ".gitignore");
  const entry = ".bones/";
  if (!(await exists(ignorePath))) {
    await writeFile(ignorePath, `${entry}\n`, { encoding: "utf8", flag: "wx" });
    return;
  }

  const existing = await readFile(ignorePath, "utf8");
  const alreadyIgnored = existing
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => line === entry || line === ".bones");
  if (alreadyIgnored) return;

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await appendFile(ignorePath, `${separator}${entry}\n`, "utf8");
}

function packageManagerCommand(
  manager: "pnpm" | "yarn" | "bun" | "npm",
  script: string
): readonly string[] {
  if (manager === "npm" || manager === "bun") return [manager, "run", script];
  return [manager, script];
}

async function detectPackageManager(root: string): Promise<"pnpm" | "yarn" | "bun" | "npm"> {
  if (await exists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(root, "yarn.lock"))) return "yarn";
  if (
    (await exists(path.join(root, "bun.lock"))) ||
    (await exists(path.join(root, "bun.lockb")))
  ) {
    return "bun";
  }
  return "npm";
}

export async function detectValidationChecks(root: string): Promise<ReadonlyArray<ValidationCheck>> {
  const packagePath = path.join(root, "package.json");
  if (await exists(packagePath)) {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const manager = await detectPackageManager(root);
    const selected = scripts.check
      ? ["check"]
      : ["typecheck", "lint", "test"].filter((script) => scripts[script]);
    if (selected.length > 0) {
      return selected.map((script) => ({
        id: script,
        argv: packageManagerCommand(manager, script),
        timeoutMs: script === "test" ? 900_000 : 300_000,
      }));
    }
  }

  if (await exists(path.join(root, "Cargo.toml"))) {
    return [{ id: "cargo-test", argv: ["cargo", "test"], timeoutMs: 900_000 }];
  }
  if (await exists(path.join(root, "go.mod"))) {
    return [{ id: "go-test", argv: ["go", "test", "./..."], timeoutMs: 900_000 }];
  }
  return [];
}

export function getStateHome(): string {
  return resolveStateHome({
    platform: process.platform,
    env: process.env,
    homeDirectory: homedir(),
  });
}

export function findProjectRoot(startDirectory: string): Effect.Effect<string, ProjectError> {
  return Effect.tryPromise({
    try: async () => {
      let current = path.resolve(startDirectory);
      while (true) {
        if (await exists(path.join(current, PROJECT_DIRECTORY, PROJECT_FILE))) return current;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      throw new Error(`No ${PROJECT_DIRECTORY}/${PROJECT_FILE} found from ${startDirectory}.`);
    },
    catch: (cause) =>
      new ProjectError({ message: "This directory is not initialized for Bones.", cause }),
  });
}

export function loadProjectContext(startDirectory: string): Effect.Effect<ProjectContext, ProjectError> {
  return Effect.gen(function* () {
    const root = yield* findProjectRoot(startDirectory);
    const load = Effect.tryPromise({
      try: async () => {
        const project = decodeProjectConfig(
          await readJsonFile(path.join(root, PROJECT_DIRECTORY, PROJECT_FILE))
        );
        const workflow = decodeWorkflowConfig(
          await readJsonFile(path.join(root, PROJECT_DIRECTORY, WORKFLOW_FILE))
        );
        return { root, stateHome: getStateHome(), project, workflow };
      },
      catch: (cause) => new ProjectError({ message: "Bones project configuration is invalid.", cause }),
    });
    return yield* load;
  });
}

export function initializeProject(rootInput: string): Effect.Effect<{
  readonly context: ProjectContext;
  readonly alreadyInitialized: boolean;
}, ProjectError> {
  const root = path.resolve(rootInput);
  return Effect.tryPromise({
    try: async () => {
      const bonesDirectory = path.join(root, PROJECT_DIRECTORY);
      const projectPath = path.join(bonesDirectory, PROJECT_FILE);
      const workflowPath = path.join(bonesDirectory, WORKFLOW_FILE);
      await ensureBonesIgnored(root);
      await mkdir(bonesDirectory, { recursive: true });

      const alreadyInitialized = await exists(projectPath);
      let project: ProjectConfig;
      if (alreadyInitialized) {
        project = decodeProjectConfig(await readJsonFile(projectPath));
      } else {
        let name = path.basename(root);
        const packagePath = path.join(root, "package.json");
        if (await exists(packagePath)) {
          const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { name?: string };
          if (packageJson.name?.trim()) name = packageJson.name.trim();
        }
        project = {
          schemaVersion: 1,
          projectId: randomUUID(),
          name,
          createdAt: new Date().toISOString(),
        };
        await writeJsonExclusive(projectPath, project);
      }

      let workflow: WorkflowConfig;
      if (await exists(workflowPath)) {
        workflow = decodeWorkflowConfig(await readJsonFile(workflowPath));
      } else {
        workflow = {
          ...DEFAULT_WORKFLOW_CONFIG,
          validation: { checks: await detectValidationChecks(root) },
        };
        await writeJsonExclusive(workflowPath, workflow);
      }

      return {
        context: { root, stateHome: getStateHome(), project, workflow },
        alreadyInitialized,
      };
    },
    catch: (cause) => new ProjectError({ message: `Could not initialize Bones in ${root}.`, cause }),
  });
}
