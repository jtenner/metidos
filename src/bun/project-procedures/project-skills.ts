import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import type { RpcProjectSkill } from "../rpc-schema";
import { pathIsWithinRoot } from "./shared";

export const MAX_PROJECT_SKILL_MD_BYTES = 128 * 1024;
export const MAX_PROJECT_SKILLS_PER_WORKTREE = 500;

export function discoverProjectSkillsFromWorktree(
  worktreePath: string,
): RpcProjectSkill[] {
  const skillsDir = resolve(worktreePath, ".pi", "skills");
  const skills: RpcProjectSkill[] = [];

  if (!existsSync(skillsDir)) {
    return skills;
  }

  let realWorktreePath: string;
  let realSkillsDir: string;
  try {
    realWorktreePath = realpathSync(worktreePath);
    realSkillsDir = realpathSync(skillsDir);
  } catch {
    return skills;
  }

  if (!pathIsWithinRoot(realWorktreePath, realSkillsDir)) {
    return skills;
  }

  let entries: string[] = [];
  try {
    entries = readdirSync(skillsDir)
      .sort((left, right) => left.localeCompare(right))
      .slice(0, MAX_PROJECT_SKILLS_PER_WORKTREE);
  } catch {
    return skills;
  }

  for (const entry of entries) {
    const skillPath = resolve(skillsDir, entry);
    const skillMdPath = resolve(skillPath, "SKILL.md");

    let realSkillMdPath: string;
    try {
      realSkillMdPath = realpathSync(skillMdPath);
    } catch {
      continue;
    }

    if (!pathIsWithinRoot(realSkillsDir, realSkillMdPath)) {
      continue;
    }

    let description: string | null = null;
    try {
      const skillMdStat = statSync(realSkillMdPath);
      if (
        skillMdStat.isFile() &&
        skillMdStat.size <= MAX_PROJECT_SKILL_MD_BYTES
      ) {
        const content = readFileSync(realSkillMdPath, "utf-8");
        description = parseProjectSkillDescription(content);
      }
    } catch {
      // Ignore read/parse errors and return skill without description.
    }

    skills.push({ name: entry, description });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

function parseProjectSkillDescription(content: string): string | null {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const frontmatter = frontmatterMatch?.[1];
  if (!frontmatter) {
    return null;
  }

  const descMatch = frontmatter.match(/description:\s*["']?([^\n"']+)["']?/);
  const parsedDescription = descMatch?.[1];
  return parsedDescription ? parsedDescription.trim() : null;
}
