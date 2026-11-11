import { useEffect } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/admin.refunds";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  approveRefundRequest,
  declineRefundRequest,
  getRequestedRefunds,
  type RefundProgress,
} from "~/lib/refunds.server";
import { db } from "~/db";
import { UserRole, users } from "~/db/schema";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { AlertTriangle, ReceiptText } from "lucide-react";

const refundActionSchema = z.object({
  intent: z.enum(["approve", "decline"]),
  refundId: z.coerce.number().int(),
});

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

async function requireAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to review refunds.", {
      status: 401,
    });
  }

  const currentUser = getUserById(currentUserId);

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can review Refund Requests.", { status: 403 });
  }

  return currentUser;
}

/**
 * The email the learner gets once their Refund Request is resolved. There is
 * no mail transport wired up yet, so the built message goes to the server log.
 */
function buildRefundResolvedEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  amount: number;
  approved: boolean;
  isTeamLicence: boolean;
}) {
  const outcome = input.approved
    ? [
        `Your refund request for "${input.courseTitle}" has been approved. We are refunding ${formatPrice(input.amount)}, the amount you paid.`,
        "",
        input.isTeamLicence
          ? "The unclaimed seats on your team licence can no longer be claimed."
          : "Your access to the course has ended, and your progress in it has been removed.",
      ]
    : [
        `Your refund request for "${input.courseTitle}" has been declined. You keep your access to the course.`,
      ];

  return {
    to: input.learnerEmail,
    subject: `Refund ${input.approved ? "approved" : "declined"} — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      ...outcome,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Review Requested Refund Requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return { refundRequests: getRequestedRefunds() };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    return data({ error: "Invalid input." }, { status: 400 });
  }

  const { intent, refundId } = parsed.data;
  const approved = intent === "approve";
  const result = approved
    ? approveRefundRequest(refundId, admin.id)
    : declineRefundRequest(refundId, admin.id);

  if (!result.ok) {
    return data({ error: result.reason }, { status: result.status });
  }

  const email = buildRefundResolvedEmail({
    learnerName: result.learner.name,
    learnerEmail: result.learner.email,
    courseTitle: result.courseTitle,
    amount: result.amount,
    approved,
    isTeamLicence: result.isTeamLicence,
  });

  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);

  return { success: true, approved };
}

function formatDuration(seconds: number) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ProgressCell({
  progress,
  isTeamLicence,
}: {
  progress: RefundProgress | null;
  isTeamLicence: boolean;
}) {
  if (isTeamLicence || !progress) {
    return <span className="text-sm text-muted-foreground">Team licence</span>;
  }

  return (
    <div className="text-sm">
      <div>
        {progress.completedLessons} / {progress.totalLessons} lessons
      </div>
      <div className="text-muted-foreground">
        {formatDuration(progress.secondsWatched)} watched
      </div>
      {progress.overLimit && (
        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
          <AlertTriangle className="size-3" />
          Now over the limit
        </span>
      )}
    </div>
  );
}

type RefundRequestRow = Route.ComponentProps["loaderData"]["refundRequests"][number];

function RefundRequestRow({ refundRequest }: { refundRequest: RefundRequestRow }) {
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if ("error" in fetcher.data) {
      toast.error(fetcher.data.error);
    } else if (fetcher.data.success) {
      toast.success(
        fetcher.data.approved
          ? "Refund Request approved."
          : "Refund Request declined."
      );
    }
  }, [fetcher.state, fetcher.data]);

  function submit(intent: "approve" | "decline") {
    fetcher.submit(
      { intent, refundId: String(refundRequest.id) },
      { method: "post" }
    );
  }

  const approveBlocked = refundRequest.hasClaimedSeat;

  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-4 py-3">
        <div className="text-sm font-medium">{refundRequest.learnerName}</div>
        <div className="text-sm text-muted-foreground">
          {refundRequest.learnerEmail}
        </div>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/courses/${refundRequest.courseSlug}`}
          className="text-sm font-medium hover:underline"
        >
          {refundRequest.courseTitle}
        </Link>
        <div className="text-sm text-muted-foreground">
          {formatPrice(refundRequest.amount)} · bought{" "}
          {formatDate(refundRequest.purchasedAt)}
        </div>
      </td>
      <td className="max-w-xs px-4 py-3">
        <p className="whitespace-pre-wrap text-sm">{refundRequest.reason}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Requested {formatDate(refundRequest.requestedAt)}
        </p>
      </td>
      <td className="px-4 py-3">
        <ProgressCell
          progress={refundRequest.progress}
          isTeamLicence={refundRequest.isTeamLicence}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={isSubmitting || approveBlocked}
            title={
              approveBlocked
                ? "A team licence with a claimed seat cannot be refunded."
                : undefined
            }
            onClick={() => submit("approve")}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => submit("decline")}
          >
            Decline
          </Button>
        </div>
        {approveBlocked && (
          <p className="mt-1 text-xs text-muted-foreground">
            A seat has been claimed.
          </p>
        )}
      </td>
    </tr>
  );
}

const headings = ["Learner", "Course", "Reason", "Progress", "Decision"];

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline Refund Requests, oldest first. Approving ends the
          learner's access to the course and erases their progress.
        </p>
      </div>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No Refund Requests are waiting.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {headings.map((heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {refundRequests.map((refundRequest) => (
                    <RefundRequestRow
                      key={refundRequest.id}
                      refundRequest={refundRequest}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading Refund Requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
    } else if (error.status === 403) {
      title = "Access denied";
    } else {
      title = `Error ${error.status}`;
    }
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
