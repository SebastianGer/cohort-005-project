import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { eq } from "drizzle-orm";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  approveRefundRequest,
  declineRefundRequest,
  getRefundEligibility,
  getRequestedRefunds,
  isPurchaseRefunded,
} from "./refunds.server";

const PURCHASED_AT = new Date(2026, 10, 1, 23, 0);

function daysAfterPurchase(days: number) {
  const when = new Date(PURCHASED_AT);
  when.setDate(when.getDate() + days);
  when.setHours(12);
  return when;
}

function purchase(amountPaid = 4900) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid,
      country: "US",
      createdAt: PURCHASED_AT.toISOString(),
    })
    .returning()
    .get();
}

function refundRequest(purchaseId: number, status: schema.RefundStatus) {
  return testDb
    .insert(schema.refunds)
    .values({ purchaseId, status, reason: "Not what I expected." })
    .returning()
    .get();
}

function admin() {
  return testDb
    .insert(schema.users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      role: schema.UserRole.Admin,
    })
    .returning()
    .get();
}

function seat(purchaseId: number, code: string, claimedBy?: number) {
  const team = testDb.insert(schema.teams).values({}).returning().get();
  testDb
    .insert(schema.coupons)
    .values({
      teamId: team.id,
      courseId: base.course.id,
      code,
      purchaseId,
      redeemedByUserId: claimedBy ?? null,
      redeemedAt: claimedBy ? PURCHASED_AT.toISOString() : null,
    })
    .run();
}

function addLessons(count: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module", position: 1 })
    .returning()
    .get();

  return Array.from({ length: count }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i}`, position: i })
      .returning()
      .get()
  );
}

describe("getRefundEligibility", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    testDb
      .update(schema.courses)
      .set({ price: 9900 })
      .where(eq(schema.courses.id, base.course.id))
      .run();
  });

  it("is not eligible without a Purchase", () => {
    const result = getRefundEligibility(
      base.user.id,
      base.course.id,
      daysAfterPurchase(1)
    );
    expect(result).toMatchObject({ eligible: false, status: 403 });
  });

  it("offers a Refund of what was paid, not the list price", () => {
    const p = purchase(4900);
    const result = getRefundEligibility(
      base.user.id,
      base.course.id,
      daysAfterPurchase(1)
    );
    expect(result).toEqual({
      eligible: true,
      purchaseId: p.id,
      amount: 4900,
      lastDayOfRefundWindow: "2026-11-15",
    });
  });

  it("stays eligible through the whole fourteenth calendar day", () => {
    purchase();
    expect(
      getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(14))
        .eligible
    ).toBe(true);
    expect(
      getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(15))
        .eligible
    ).toBe(false);
  });

  it("blocks a second Refund Request while one is Requested", () => {
    const p = purchase();
    refundRequest(p.id, schema.RefundStatus.Requested);
    const result = getRefundEligibility(
      base.user.id,
      base.course.id,
      daysAfterPurchase(1)
    );
    expect(result).toMatchObject({ eligible: false, status: 409 });
  });

  it("allows asking again after a Declined Refund Request", () => {
    const p = purchase();
    refundRequest(p.id, schema.RefundStatus.Declined);
    expect(
      getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
        .eligible
    ).toBe(true);
  });

  it("is not eligible once the Purchase is Refunded", () => {
    const p = purchase();
    refundRequest(p.id, schema.RefundStatus.Approved);
    expect(
      getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
        .eligible
    ).toBe(false);
  });

  it("is not eligible when a Seat of the Team Licence is Claimed", () => {
    const p = purchase();
    const team = testDb.insert(schema.teams).values({}).returning().get();
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "SEAT-1",
        purchaseId: p.id,
        redeemedByUserId: base.user.id,
        redeemedAt: PURCHASED_AT.toISOString(),
      })
      .run();
    expect(
      getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
        .eligible
    ).toBe(false);
  });

  it("is not eligible after completing half the lessons", () => {
    purchase();
    const [first] = addLessons(2);
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: first.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
    expect(
      getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
        .eligible
    ).toBe(false);
  });

  it("is not eligible after watching two hours", () => {
    purchase();
    const [first, second] = addLessons(4);
    for (const lesson of [first, second]) {
      testDb
        .insert(schema.videoWatchEvents)
        .values({
          userId: base.user.id,
          lessonId: lesson.id,
          eventType: "progress",
          positionSeconds: 60 * 60,
        })
        .run();
    }
    expect(
      getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
        .eligible
    ).toBe(false);
  });
});

describe("one Refund per course", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("is not eligible on a later Purchase after a Refund for the course", () => {
    const first = purchase();
    refundRequest(first.id, schema.RefundStatus.Approved);
    purchase();
    expect(
      getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
    ).toMatchObject({ eligible: false });
  });

  it("does not count a Refund of a Team Licence", () => {
    const licence = purchase();
    seat(licence.id, "SEAT-1");
    refundRequest(licence.id, schema.RefundStatus.Approved);
    testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 4900,
        createdAt: new Date(PURCHASED_AT.getTime() + 60_000).toISOString(),
      })
      .run();
    expect(
      getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
        .eligible
    ).toBe(true);
  });
});

describe("resolving Refund Requests", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  function enrolWithProgress() {
    const p = purchase();
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    const [lesson] = addLessons(4);
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lesson.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
    testDb
      .insert(schema.videoWatchEvents)
      .values({
        userId: base.user.id,
        lessonId: lesson.id,
        eventType: "progress",
        positionSeconds: 600,
      })
      .run();
    const quiz = testDb
      .insert(schema.quizzes)
      .values({ lessonId: lesson.id, title: "Quiz", passingScore: 0.5 })
      .returning()
      .get();
    const question = testDb
      .insert(schema.quizQuestions)
      .values({
        quizId: quiz.id,
        questionText: "?",
        questionType: schema.QuestionType.TrueFalse,
        position: 1,
      })
      .returning()
      .get();
    const option = testDb
      .insert(schema.quizOptions)
      .values({ questionId: question.id, optionText: "True", isCorrect: true })
      .returning()
      .get();
    const attempt = testDb
      .insert(schema.quizAttempts)
      .values({ userId: base.user.id, quizId: quiz.id, score: 1, passed: true })
      .returning()
      .get();
    testDb
      .insert(schema.quizAnswers)
      .values({
        attemptId: attempt.id,
        questionId: question.id,
        selectedOptionId: option.id,
      })
      .run();
    return p;
  }

  function countFor(table: typeof schema.lessonProgress | typeof schema.videoWatchEvents | typeof schema.quizAttempts | typeof schema.enrollments) {
    return testDb
      .select()
      .from(table)
      .where(eq(table.userId, base.user.id))
      .all().length;
  }

  it("lists Requested Refund Requests with live progress", () => {
    const p = enrolWithProgress();
    refundRequest(p.id, schema.RefundStatus.Requested);
    const [row] = getRequestedRefunds();
    expect(row).toMatchObject({
      learnerId: base.user.id,
      amount: 4900,
      isTeamLicence: false,
      progress: {
        completedLessons: 1,
        totalLessons: 4,
        secondsWatched: 600,
        overLimit: false,
      },
    });
  });

  it("flags a learner who has gone over a limit since asking", () => {
    const p = enrolWithProgress();
    refundRequest(p.id, schema.RefundStatus.Requested);
    const [, second] = testDb.select().from(schema.lessons).all();
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: second.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
    expect(getRequestedRefunds()[0].progress?.overLimit).toBe(true);
  });

  it("leaves out Resolved Refund Requests", () => {
    const p = purchase();
    refundRequest(p.id, schema.RefundStatus.Declined);
    expect(getRequestedRefunds()).toEqual([]);
  });

  it("approving refunds the Purchase and erases access and progress", () => {
    const p = enrolWithProgress();
    const request = refundRequest(p.id, schema.RefundStatus.Requested);
    const a = admin();

    const result = approveRefundRequest(request.id, a.id);

    expect(result).toMatchObject({ ok: true, amount: 4900 });
    const stored = testDb
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, request.id))
      .get();
    expect(stored).toMatchObject({
      status: schema.RefundStatus.Approved,
      amountRefunded: 4900,
      resolvedByUserId: a.id,
    });
    expect(isPurchaseRefunded(p.id)).toBe(true);
    expect(countFor(schema.enrollments)).toBe(0);
    expect(countFor(schema.lessonProgress)).toBe(0);
    expect(countFor(schema.videoWatchEvents)).toBe(0);
    expect(countFor(schema.quizAttempts)).toBe(0);
    expect(testDb.select().from(schema.quizAnswers).all()).toEqual([]);
  });

  it("declining keeps access and progress", () => {
    const p = enrolWithProgress();
    const request = refundRequest(p.id, schema.RefundStatus.Requested);

    const result = declineRefundRequest(request.id, admin().id);

    expect(result.ok).toBe(true);
    expect(isPurchaseRefunded(p.id)).toBe(false);
    expect(countFor(schema.enrollments)).toBe(1);
    expect(countFor(schema.lessonProgress)).toBe(1);
  });

  it("cannot resolve a Refund Request twice", () => {
    const p = purchase();
    const request = refundRequest(p.id, schema.RefundStatus.Requested);
    const a = admin();
    declineRefundRequest(request.id, a.id);
    expect(approveRefundRequest(request.id, a.id)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("will not approve a Team Licence once a Seat is Claimed", () => {
    const licence = purchase();
    const request = refundRequest(licence.id, schema.RefundStatus.Requested);
    seat(licence.id, "SEAT-1", base.instructor.id);
    expect(approveRefundRequest(request.id, admin().id)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("approving a Team Licence leaves the buyer's own enrollment alone", () => {
    const licence = enrolWithProgress();
    seat(licence.id, "SEAT-1");
    const request = refundRequest(licence.id, schema.RefundStatus.Requested);
    expect(approveRefundRequest(request.id, admin().id).ok).toBe(true);
    expect(isPurchaseRefunded(licence.id)).toBe(true);
    expect(countFor(schema.enrollments)).toBe(1);
    expect(countFor(schema.lessonProgress)).toBe(1);
  });
});
