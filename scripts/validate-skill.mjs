import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const skillDirectory = resolve(process.argv[2] ?? "skills/bones");
const skillPath = join(skillDirectory, "SKILL.md");
const agentPath = join(skillDirectory, "agents", "openai.yaml");

const [skill, agent] = await Promise.all([
  readFile(skillPath, "utf8"),
  readFile(agentPath, "utf8"),
]);

const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
if (!frontmatter) throw new Error("SKILL.md must start with YAML frontmatter.");

const metadata = frontmatter[1] ?? "";
const keys = [...metadata.matchAll(/^([a-zA-Z0-9_-]+):/gm)].map((match) => match[1]);
if (keys.join(",") !== "name,description") {
  throw new Error("SKILL.md frontmatter must contain only name and description, in that order.");
}
if (!/^name: bones$/m.test(metadata)) throw new Error("Skill name must be bones.");
if (!/default_prompt: "[^"]*\$bones[^"]*"/.test(agent)) {
  throw new Error("agents/openai.yaml default_prompt must mention $bones.");
}

console.log(`Validated Bones skill at ${skillDirectory}`);
