import { MAX_NOTE_LENGTH } from "~/lib/notes";

export type NoteDraft = {
  length: number;
  max: number;
  tooLong: boolean;
  empty: boolean;
  dirty: boolean;
  canSave: boolean;
};

export function summariseDraft(
  draft: string,
  savedBody: string | null,
  max: number = MAX_NOTE_LENGTH
): NoteDraft {
  // Saving trims the note and rejects a blank one, so judge what would be
  // stored, not what was typed.
  const stored = draft.trim();
  const length = stored.length;
  const tooLong = length > max;
  const empty = length === 0;
  const dirty = stored !== (savedBody ?? "");
  return {
    length,
    max,
    tooLong,
    empty,
    dirty,
    canSave: dirty && !empty && !tooLong,
  };
}
