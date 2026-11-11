import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  coupons,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  quizAnswers,
  quizAttempts,
  quizzes,
  refunds,
  users,
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

function isTeamLicence(purchaseId: number) {
  const row = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();
  return row !== undefined;
}

/**
 * Whether the learner has ever had a Refund for a personal Purchase of this
 * course. Refunding a Team Licence does not count.
 */
function hasHadPersonalRefund(userId: number, courseId: number) {
  const approved = db
    .select({ purchaseId: purchases.id })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        eq(refunds.status, RefundStatus.Approved)
      )
    )
    .all();
  return approved.some((row) => !isTeamLicence(row.purchaseId));
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

  // Erasing progress on a Refund resets the limits below, so a learner only
  // ever gets one Refund per course. See docs/adr/0001.
  if (hasHadPersonalRefund(userId, courseId)) {
    return ineligible("You have already had a refund for this course.");
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

// ─── Resolving Refund Requests ───

export type RefundProgress = {
  completedLessons: number;
  totalLessons: number;
  secondsWatched: number;
  /** Past a Refund Eligibility limit now, even if they weren't when asking. */
  overLimit: boolean;
};

function getProgress(userId: number, courseId: number): RefundProgress {
  const lessonIds = getLessonIdsForCourse(courseId);
  const completedLessons = getCompletedLessonCount(userId, lessonIds);
  const secondsWatched = getSecondsWatched(userId, lessonIds);
  const overLimit =
    (lessonIds.length > 0 &&
      completedLessons / lessonIds.length >= COMPLETION_LIMIT) ||
    secondsWatched >= WATCHED_SECONDS_LIMIT;
  return {
    completedLessons,
    totalLessons: lessonIds.length,
    secondsWatched,
    overLimit,
  };
}

/** Every Requested Refund Request, oldest first, with live progress. */
export function getRequestedRefunds() {
  const rows = db
    .select({
      id: refunds.id,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      purchaseId: purchases.id,
      amount: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.status, RefundStatus.Requested))
    .orderBy(refunds.requestedAt, refunds.id)
    .all();

  return rows.map((row) => {
    const teamLicence = isTeamLicence(row.purchaseId);
    return {
      ...row,
      isTeamLicence: teamLicence,
      hasClaimedSeat: teamLicence && hasClaimedSeat(row.purchaseId),
      // A Team Licence buyer doesn't take the course through it.
      progress: teamLicence ? null : getProgress(row.learnerId, row.courseId),
    };
  });
}

export type RefundResolution =
  | {
      ok: true;
      learner: { name: string; email: string };
      courseTitle: string;
      amount: number;
      isTeamLicence: boolean;
    }
  | { ok: false; reason: string; status: 404 | 409 };

function getRefundRequestDetails(refundId: number) {
  return db
    .select({
      status: refunds.status,
      purchaseId: purchases.id,
      amount: purchases.amountPaid,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.id, refundId))
    .get();
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Removes the learner's access to the course and erases their progress in it. */
function revokeAccessAndEraseProgress(
  tx: Tx,
  userId: number,
  courseId: number
) {
  const lessonIds = getLessonIdsForCourse(courseId);

  if (lessonIds.length > 0) {
    const attemptIds = tx
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
      .where(
        and(
          eq(quizAttempts.userId, userId),
          inArray(quizzes.lessonId, lessonIds)
        )
      )
      .all()
      .map((row) => row.id);

    if (attemptIds.length > 0) {
      tx.delete(quizAnswers)
        .where(inArray(quizAnswers.attemptId, attemptIds))
        .run();
      tx.delete(quizAttempts).where(inArray(quizAttempts.id, attemptIds)).run();
    }

    tx.delete(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          inArray(lessonProgress.lessonId, lessonIds)
        )
      )
      .run();

    tx.delete(videoWatchEvents)
      .where(
        and(
          eq(videoWatchEvents.userId, userId),
          inArray(videoWatchEvents.lessonId, lessonIds)
        )
      )
      .run();
  }

  tx.delete(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .run();
}

function resolve(
  refundId: number,
  adminId: number,
  status: RefundStatus.Approved | RefundStatus.Declined,
  now: Date
): RefundResolution {
  const request = getRefundRequestDetails(refundId);

  if (!request) {
    return { ok: false, reason: "Refund Request not found.", status: 404 };
  }

  if (request.status !== RefundStatus.Requested) {
    return {
      ok: false,
      reason: "This Refund Request has already been resolved.",
      status: 409,
    };
  }

  const teamLicence = isTeamLicence(request.purchaseId);

  if (
    status === RefundStatus.Approved &&
    teamLicence &&
    hasClaimedSeat(request.purchaseId)
  ) {
    return {
      ok: false,
      reason: "A team licence with a claimed seat cannot be refunded.",
      status: 409,
    };
  }

  db.transaction((tx) => {
    tx.update(refunds)
      .set({
        status,
        amountRefunded:
          status === RefundStatus.Approved ? request.amount : null,
        resolvedAt: now.toISOString(),
        resolvedByUserId: adminId,
      })
      .where(eq(refunds.id, refundId))
      .run();

    // A Team Licence buyer isn't enrolled through it, so there is no access
    // or progress of theirs to take away; its unclaimed Seats stop working.
    if (status === RefundStatus.Approved && !teamLicence) {
      revokeAccessAndEraseProgress(tx, request.learnerId, request.courseId);
    }
  });

  return {
    ok: true,
    learner: { name: request.learnerName, email: request.learnerEmail },
    courseTitle: request.courseTitle,
    amount: request.amount,
    isTeamLicence: teamLicence,
  };
}

/**
 * Approve a Refund Request: the Purchase becomes Refunded, and the learner
 * loses access to the course and their progress in it.
 */
export function approveRefundRequest(
  refundId: number,
  adminId: number,
  now: Date = new Date()
) {
  return resolve(refundId, adminId, RefundStatus.Approved, now);
}

/** Decline a Refund Request: nothing is returned and the learner keeps access. */
export function declineRefundRequest(
  refundId: number,
  adminId: number,
  now: Date = new Date()
) {
  return resolve(refundId, adminId, RefundStatus.Declined, now);
}

/** Whether this Purchase has had a Refund. */
export function isPurchaseRefunded(purchaseId: number) {
  return hasRefundRequestIn(purchaseId, RefundStatus.Approved);
}
