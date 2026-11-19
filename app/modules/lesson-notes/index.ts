import { summariseDraft, type NoteDraft } from "./lib/draft";

export type { NoteDraft };

/**
 * What the note editor shows about the text being typed: how long it is
 * against the limit, whether it differs from the saved note, and whether
 * Save would be accepted.
 */
export function describeNoteDraft(
  draft: string,
  savedBody: string | null,
  max?: number
): NoteDraft {
  return summariseDraft(draft, savedBody, max);
}
