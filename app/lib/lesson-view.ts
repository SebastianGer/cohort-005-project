import type { LessonProgressStatus, lessons } from "~/db/schema";
import type { DenialReason } from "~/modules/permissions/course-permissions.server";
import type { RenderedComment } from "~/lib/rendered-comment";

// What the lesson page's loader hands to its views. The components declare
// these instead of reading the route's generated +types, so they stay plain
// components; the route checks its loader data against them when it renders.

type CourseRef = { id: number; title: string; slug: string };
type CurriculumModule = {
  id: number;
  title: string;
  lessons: Array<{ id: number; title: string }>;
};
type ModuleRef = { id: number; title: string };
type NeighbourLesson = {
  id: number;
  title: string;
  moduleId: number;
  moduleTitle: string;
};

export type LessonQuiz = {
  id: number;
  title: string;
  passingScore: number;
  questions: Array<{
    id: number;
    questionText: string;
    questionType: string;
    position: number;
    options: Array<{ id: number; optionText: string }>;
  }>;
};

export type LockedLessonView = {
  view: "locked";
  course: CourseRef;
  curriculum: CurriculumModule[];
  module: ModuleRef;
  lesson: { id: number; title: string };
  enrolled: boolean;
  lockedReason: DenialReason;
};

export type FullLessonView = {
  view: "full";
  course: CourseRef;
  curriculum: CurriculumModule[];
  module: ModuleRef;
  lesson: typeof lessons.$inferSelect;
  contentHtml: string | null;
  lessonStatus: LessonProgressStatus | null;
  enrolled: boolean;
  currentUserId: number | null;
  prevLesson: NeighbourLesson | null;
  nextLesson: NeighbourLesson | null;
  quiz: LessonQuiz | null;
  bestAttempt: { score: number; passed: boolean } | null;
  lastWatchPosition: number;
  watchProgress: number;
  lessonProgressMap: Record<number, LessonProgressStatus>;
  comments: RenderedComment[];
  canModerate: boolean;
  instructorName: string;
  bookmarked: boolean;
  note: { body: string; updatedAt: string } | null;
};
