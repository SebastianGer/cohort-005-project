import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.fake.server";
import {
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  noteBodySchema,
  saveNote,
  toggleBookmark,
} from "./bookmarks-and-notes.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const LATER = new Date(2026, 9, 7, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;

  otherLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 2", position: 2 })
    .returning()
    .get().id;
});

describe("bookmarks", () => {
  it("toggles a Bookmark on and off", () => {
    expect(isBookmarked(db, base.user.id, lessonId)).toBe(false);

    expect(toggleBookmark(db, base.user.id, lessonId)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonId)).toBe(true);

    expect(toggleBookmark(db, base.user.id, lessonId)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonId)).toBe(false);
  });

  it("keeps one Student's Bookmarks apart from another's", () => {
    toggleBookmark(db, base.user.id, lessonId);

    expect(isBookmarked(db, base.instructor.id, lessonId)).toBe(false);
    expect(listBookmarks(db, base.instructor.id)).toEqual([]);
  });

  it("lists Bookmarks newest first with the Lesson they point at", () => {
    toggleBookmark(db, base.user.id, lessonId);
    toggleBookmark(db, base.user.id, otherLessonId);

    expect(listBookmarks(db, base.user.id)).toMatchObject([
      {
        lessonId: otherLessonId,
        lessonTitle: "Lesson 2",
        moduleTitle: "Basics",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
      { lessonId, lessonTitle: "Lesson 1" },
    ]);
  });
});

describe("one per Student per Lesson", () => {
  it("is enforced by the database for Bookmarks", () => {
    toggleBookmark(db, base.user.id, lessonId);

    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId })
        .run()
    ).toThrow();
  });

  it("is enforced by the database for Notes", () => {
    saveNote(db, base.user.id, lessonId, "Mine", NOW);

    expect(() =>
      db
        .insert(schema.notes)
        .values({ userId: base.user.id, lessonId, body: "Another" })
        .run()
    ).toThrow();
  });
});

describe("notes", () => {
  it("creates a Note on first save and updates it after", () => {
    saveNote(db, base.user.id, lessonId, "First thought", NOW);
    saveNote(db, base.user.id, lessonId, "Second thought", LATER);

    const note = getNote(db, base.user.id, lessonId);
    expect(note).toMatchObject({
      body: "Second thought",
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
    expect(db.select().from(schema.notes).all()).toHaveLength(1);
  });

  it("keeps one Student's Notes apart from another's", () => {
    saveNote(db, base.user.id, lessonId, "Private", NOW);

    expect(getNote(db, base.instructor.id, lessonId)).toBeUndefined();
    expect(listNotes(db, base.instructor.id)).toEqual([]);
  });

  it("lists Notes last edited first", () => {
    saveNote(db, base.user.id, lessonId, "Older", NOW);
    saveNote(db, base.user.id, otherLessonId, "Newer", LATER);

    expect(listNotes(db, base.user.id)).toMatchObject([
      {
        body: "Newer",
        lessonId: otherLessonId,
        lessonTitle: "Lesson 2",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
      { body: "Older", lessonId },
    ]);
  });

  it("trims the body", () => {
    expect(noteBodySchema.parse("  hi  ")).toBe("hi");
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    expect(noteBodySchema.safeParse("x".repeat(2000)).success).toBe(true);
  });

  it("refuses a Note over 2,000 characters with a clear message", () => {
    const result = noteBodySchema.safeParse("x".repeat(2001));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      "A note can be at most 2,000 characters."
    );
  });

  it("treats a whitespace-only Note as empty", () => {
    expect(noteBodySchema.parse("   ")).toBe("");
  });

  it("deletes the Note when saved empty", () => {
    saveNote(db, base.user.id, lessonId, "Something", NOW);
    saveNote(db, base.user.id, lessonId, "", LATER);

    expect(getNote(db, base.user.id, lessonId)).toBeUndefined();
    expect(listNotes(db, base.user.id)).toEqual([]);
  });
});

describe("approving a Refund", () => {
  it("keeps the Student's Bookmarks and Notes", async () => {
    const notifications = fakeNotifications();
    const admin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: NOW.toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    toggleBookmark(db, base.user.id, lessonId);
    saveNote(db, base.user.id, lessonId, "Still mine", NOW);

    const raised = await raiseRefundRequest(
      db,
      purchase.id,
      base.user.id,
      "It was not what I expected.",
      NOW,
      notifications
    );
    if (!raised.ok) throw new Error(raised.error);
    const approved = await approveRefundRequest(
      db,
      raised.refundRequestId,
      admin.id,
      null,
      NOW,
      notifications
    );

    expect(approved.ok).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonId)).toBe(true);
    expect(getNote(db, base.user.id, lessonId)?.body).toBe("Still mine");
  });
});

describe("deleting a Lesson", () => {
  it("takes its Bookmarks and Notes with it", () => {
    toggleBookmark(db, base.user.id, lessonId);
    saveNote(db, base.user.id, lessonId, "Gone soon", NOW);

    db.delete(schema.lessons).where(eq(schema.lessons.id, lessonId)).run();

    expect(listBookmarks(db, base.user.id)).toEqual([]);
    expect(listNotes(db, base.user.id)).toEqual([]);
  });
});
