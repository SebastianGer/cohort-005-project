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

import { getRefundEligibility } from "./refunds.server";

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
  testDb
    .insert(schema.refunds)
    .values({ purchaseId, status, reason: "Not what I expected." })
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
