import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverProjectSkillsFromWorktree,
  MAX_PROJECT_SKILL_MD_BYTES,
  MAX_PROJECT_SKILLS_PER_WORKTREE,
} from "./project-skills";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "metidos-project-skills-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("discoverProjectSkillsFromWorktree", () => {
  it("lists project-local skills and parses frontmatter descriptions", () => {
    const worktreePath = makeTempDir();
    const skillDir = join(worktreePath, ".pi", "skills", "local-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: local-skill\ndescription: Use for local work.\n---\n\n# Local skill\n",
    );

    expect(discoverProjectSkillsFromWorktree(worktreePath)).toEqual([
      { name: "local-skill", description: "Use for local work." },
    ]);
  });

  it("skips skill symlinks that resolve outside the project skills directory", () => {
    const worktreePath = makeTempDir();
    const skillsDir = join(worktreePath, ".pi", "skills");
    const outsideDir = makeTempDir();
    const outsideSkillDir = join(outsideDir, "escaped-skill");
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(outsideSkillDir, { recursive: true });
    writeFileSync(
      join(outsideSkillDir, "SKILL.md"),
      "---\ndescription: Escaped skill.\n---\n",
    );
    symlinkSync(outsideSkillDir, join(skillsDir, "escaped-skill"));

    expect(discoverProjectSkillsFromWorktree(worktreePath)).toEqual([]);
  });

  it("bounds project skill discovery before reading descriptions", () => {
    const worktreePath = makeTempDir();
    const skillsDir = join(worktreePath, ".pi", "skills");
    mkdirSync(skillsDir, { recursive: true });
    for (let index = 0; index <= MAX_PROJECT_SKILLS_PER_WORKTREE; index += 1) {
      const skillDir = join(
        skillsDir,
        `skill-${index.toString().padStart(3, "0")}`,
      );
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "---\ndescription: Bounded.\n---\n",
      );
    }

    const skills = discoverProjectSkillsFromWorktree(worktreePath);

    expect(skills).toHaveLength(MAX_PROJECT_SKILLS_PER_WORKTREE);
    expect(skills.at(0)?.name).toBe("skill-000");
    expect(skills.at(-1)?.name).toBe(
      `skill-${(MAX_PROJECT_SKILLS_PER_WORKTREE - 1).toString().padStart(3, "0")}`,
    );
  });

  it("does not read oversized skill descriptions", () => {
    const worktreePath = makeTempDir();
    const skillDir = join(worktreePath, ".pi", "skills", "large-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\ndescription: Too large to parse.\n---\n${"x".repeat(
        MAX_PROJECT_SKILL_MD_BYTES,
      )}`,
    );

    expect(discoverProjectSkillsFromWorktree(worktreePath)).toEqual([
      { name: "large-skill", description: null },
    ]);
  });
});
