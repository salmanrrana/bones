import { access, cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";

export interface SkillInstallation {
  readonly source: string;
  readonly target: string;
  readonly scope: "project" | "user";
  readonly alreadyInstalled: boolean;
}

export class SkillInstallError extends Data.TaggedError("SkillInstallError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function packagedSkillDirectory(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDirectory, "..", "..", "skills", "bones");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function installSkill(options: {
  readonly cwd: string;
  readonly user: boolean;
  readonly force: boolean;
}): Effect.Effect<SkillInstallation, SkillInstallError> {
  return Effect.tryPromise({
    try: async () => {
      const source = packagedSkillDirectory();
      const scope = options.user ? "user" : "project";
      const skillsRoot = options.user
        ? path.join(homedir(), ".agents", "skills")
        : path.join(path.resolve(options.cwd), ".agents", "skills");
      const target = path.join(skillsRoot, "bones");
      if (!(await exists(path.join(source, "SKILL.md")))) {
        throw new Error(`Packaged Bones skill is missing from ${source}.`);
      }

      const alreadyInstalled = await exists(path.join(target, "SKILL.md"));
      if (alreadyInstalled && !options.force) {
        return { source, target, scope, alreadyInstalled: true };
      }

      await mkdir(skillsRoot, { recursive: true });
      await cp(source, target, { recursive: true, force: options.force, errorOnExist: !options.force });
      return { source, target, scope, alreadyInstalled: false };
    },
    catch: (cause) =>
      new SkillInstallError({ message: "Could not install the Bones Agent Skill.", cause }),
  });
}
