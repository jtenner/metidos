/**
 * @file src/mainview/controls/chat-composer-skills.ts
 * @description Skill-token autocomplete helpers for the chat composer.
 */

export type ChatComposerSkillsMatch = {
  endIndex: number;
  filter: string;
  startIndex: number;
};

const SKILLS_TRIGGER = "/skills:";
const SKILLS_TRIGGER_MAX_FILTER_CHARS = 96;
const SKILLS_TRIGGER_BOUNDARY_REGEX = /\s/u;

export function matchChatComposerSkillsTrigger(
  draft: string,
  cursorIndex: number,
  availableSkills?: readonly string[] | undefined,
): ChatComposerSkillsMatch | null {
  if (!availableSkills || availableSkills.length === 0) {
    return null;
  }

  const boundedCursorIndex = Math.max(0, Math.min(cursorIndex, draft.length));
  if (boundedCursorIndex <= 0) {
    return null;
  }

  const startIndex = draft.lastIndexOf(SKILLS_TRIGGER, boundedCursorIndex - 1);
  if (startIndex < 0) {
    return null;
  }

  const filterStartIndex = startIndex + SKILLS_TRIGGER.length;
  const filterLength = boundedCursorIndex - filterStartIndex;
  if (filterLength < 0 || filterLength > SKILLS_TRIGGER_MAX_FILTER_CHARS) {
    return null;
  }

  const filter = draft.slice(filterStartIndex, boundedCursorIndex);
  if (SKILLS_TRIGGER_BOUNDARY_REGEX.test(filter)) {
    return null;
  }

  return {
    filter: filter.toLowerCase(),
    startIndex,
    endIndex: boundedCursorIndex,
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
