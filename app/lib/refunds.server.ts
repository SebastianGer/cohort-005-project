import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
} from "~/db/schema";

export const REFUND_WINDOW_DAYS = 14;
const WATCHED_SECONDS_LIMIT = 2 * 60 * 60;
const COMPLETION_LIMIT = 0.5;

export type RefundEligibility =
  | {
      eligible: true;
      purchaseId: number;
      // A Refund always returns what was paid for the Purchase.
      amount: number;
      lastDayOfRefundWindow: string;
    }
  | {
      eligible: false;
      reason: string;
      status: 403 | 409;
    };

function ineligible(reason: string, status: 403 | 409 = 403): RefundEligibility {
  return { eligible: false, reason, status };
}

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function hasRefundRequestIn(purchaseId: number, status: RefundStatus) {
  const row = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(and(eq(refunds.purchaseId, purchaseId), eq(refunds.status, status)))
    .get();
  return row !== undefined;
}

function hasClaimedSeat(purchaseId: number) {
  const row = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();
  return row !== undefined;
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

// The Refund Window is counted in calendar days, not hours — someone who buys
// at 23:00 still gets the whole of their fourteenth day.
function asCalendarDay(when: Date) {
  const year = when.getFullYear();
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether the learner can make a Refund Request for their Purchase of this
 * course, and if so, how much the Refund would be.
 */
export function getRefundEligibility(
  userId: number,
  courseId: number,
  now: Date = new Date()
): RefundEligibility {
  const purchase = getLatestPurchase(userId, courseId);

  if (!purchase) {
    return ineligible("You have not bought this course.");
  }

  if (hasRefundRequestIn(purchase.id, RefundStatus.Requested)) {
    return ineligible(
      "You already have a Refund Request waiting for this course.",
      409
    );
  }

  if (hasRefundRequestIn(purchase.id, RefundStatus.Approved)) {
    return ineligible("This purchase has already been refunded.");
  }

  const purchasedDay = asCalendarDay(new Date(purchase.createdAt));
  const windowEnd = new Date(purchase.createdAt);
  windowEnd.setDate(windowEnd.getDate() + REFUND_WINDOW_DAYS);
  const lastDayOfRefundWindow = asCalendarDay(windowEnd);
  const today = asCalendarDay(now);

  if (today < purchasedDay || today > lastDayOfRefundWindow) {
    return ineligible(`The ${REFUND_WINDOW_DAYS}-day refund window has closed.`);
  }

  // A Team Licence is only refunded whole, and only while no Seat is Claimed.
  if (hasClaimedSeat(purchase.id)) {
    return ineligible(
      "A team licence with a claimed seat cannot be refunded."
    );
  }

  const lessonIds = getLessonIdsForCourse(courseId);

  if (lessonIds.length > 0) {
    const completedCount = getCompletedLessonCount(userId, lessonIds);
    if (completedCount / lessonIds.length >= COMPLETION_LIMIT) {
      return ineligible(
        "You have completed too much of this course to get a refund."
      );
    }
  }

  if (getSecondsWatched(userId, lessonIds) >= WATCHED_SECONDS_LIMIT) {
    return ineligible(
      "You have watched too much of this course to get a refund."
    );
  }

  return {
    eligible: true,
    purchaseId: purchase.id,
    amount: purchase.amountPaid,
    lastDayOfRefundWindow,
  };
}
