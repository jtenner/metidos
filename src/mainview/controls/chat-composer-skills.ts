/**
 * @file src/mainview/controls/chat-composer-skills.ts
 * @description Skill-token autocomplete helpers for the chat composer.
 */

export type ChatComposerSkillsMatch = {
  endIndex: number;
  filter: string;
  startIndex: number;
};

const SKILLS_TRIGGER_REGEX = /\/skills:([^\s]*)$/;

export function matchChatComposerSkillsTrigger(
  draft: string,
  cursorIndex: number,
  availableSkills?: readonly string[] | undefined,
): ChatComposerSkillsMatch | null {
  if (!availableSkills || availableSkills.length === 0) {
    return null;
  }

  const textBeforeCursor = draft.slice(0, cursorIndex);
  const match = SKILLS_TRIGGER_REGEX.exec(textBeforeCursor);
  if (!match) {
    return null;
  }

  return {
    filter: (match[1] ?? "").toLowerCase(),
    startIndex: textBeforeCursor.lastIndexOf("/skills:"),
    endIndex: cursorIndex,
  };
}

export function filterChatComposerSkills(
  availableSkills: readonly string[] | undefined,
  skillsMatch: ChatComposerSkillsMatch | null,
): string[] {
  if (!skillsMatch || !availableSkills) {
    return [];
  }

  return availableSkills.filter((skill) =>
    skill.toLowerCase().includes(skillsMatch.filter),
  );
}
