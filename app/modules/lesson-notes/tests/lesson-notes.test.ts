import { describe, expect, it } from "vitest";
import { describeNoteDraft } from "~/modules/lesson-notes";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

describe("describeNoteDraft", () => {
  it("cannot save an untouched empty note", () => {
    expect(describeNoteDraft("", null)).toEqual({
      length: 0,
      max: MAX_NOTE_LENGTH,
      tooLong: false,
      empty: true,
      dirty: false,
      canSave: false,
    });
  });

  it("can save new text when there is no saved note", () => {
    const draft = describeNoteDraft("Cursor pagination", null);
    expect(draft.length).toBe(17);
    expect(draft.dirty).toBe(true);
    expect(draft.empty).toBe(false);
    expect(draft.canSave).toBe(true);
  });

  it("is clean when the draft matches the saved note", () => {
    const draft = describeNoteDraft("Same", "Same");
    expect(draft.dirty).toBe(false);
    expect(draft.canSave).toBe(false);
  });

  it("is dirty when the draft differs from the saved note", () => {
    const draft = describeNoteDraft("Same, edited", "Same");
    expect(draft.dirty).toBe(true);
    expect(draft.canSave).toBe(true);
  });

  it("ignores surrounding whitespace, which saving trims away", () => {
    const draft = describeNoteDraft("  Same\n", "Same");
    expect(draft.dirty).toBe(false);
    expect(draft.canSave).toBe(false);
  });

  it("treats whitespace-only text as empty and unsaveable", () => {
    const draft = describeNoteDraft("   \n ", "Old note");
    expect(draft.empty).toBe(true);
    expect(draft.dirty).toBe(true);
    expect(draft.canSave).toBe(false);
  });

  it("allows exactly the limit and rejects one character over", () => {
    const atLimit = describeNoteDraft("a".repeat(5), null, 5);
    expect(atLimit.tooLong).toBe(false);
    expect(atLimit.canSave).toBe(true);

    const over = describeNoteDraft("a".repeat(6), null, 5);
    expect(over.tooLong).toBe(true);
    expect(over.max).toBe(5);
    expect(over.canSave).toBe(false);
  });

  it("does not count surrounding whitespace against the limit", () => {
    const draft = describeNoteDraft(`${"a".repeat(5)}\n`, null, 5);
    expect(draft.length).toBe(5);
    expect(draft.tooLong).toBe(false);
    expect(draft.canSave).toBe(true);
  });

  it("defaults the limit to the note maximum", () => {
    const over = describeNoteDraft("a".repeat(MAX_NOTE_LENGTH + 1), null);
    expect(over.tooLong).toBe(true);
    expect(describeNoteDraft("a".repeat(MAX_NOTE_LENGTH), null).tooLong).toBe(
      false
    );
  });
});
