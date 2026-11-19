import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { StarRatingInput } from "~/components/star-rating";
import { formatPrice } from "~/lib/utils";

export function RateCourse({ userRating }: { userRating: number | null }) {
  const fetcher = useFetcher<{ ok: boolean; error: string | null }>();
  const isSubmitting = fetcher.state !== "idle";

  // Show the star the user just clicked while the request is in flight.
  const pendingRating = fetcher.formData?.get("rating");
  const displayedRating =
    pendingRating !== null && pendingRating !== undefined
      ? Number(pendingRating)
      : userRating;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="border-t pt-4">
      <p className="mb-2 text-sm font-medium">
        {userRating ? "Your rating" : "Rate this course"}
      </p>
      <fetcher.Form method="post">
        <StarRatingInput value={displayedRating} disabled={isSubmitting} />
      </fetcher.Form>
      {userRating && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Click a star to change your rating.
        </p>
      )}
    </div>
  );
}

export function RequestRefund({
  slug,
  purchaseId,
  amount,
}: {
  slug: string;
  purchaseId: number;
  amount: number;
}) {
  const fetcher = useFetcher<{ errors?: Record<string, string> }>();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const firstError = Object.values(fetcher.data?.errors ?? {})[0];
    if (fetcher.state === "idle" && firstError) {
      toast.error(firstError);
    }
  }, [fetcher.state, fetcher.data]);

  if (!isFormOpen) {
    return (
      <div className="border-t pt-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => setIsFormOpen(true)}
        >
          Request a refund
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t pt-4">
      <p className="mb-2 text-sm font-medium">Request a refund</p>
      <p className="mb-3 text-xs text-muted-foreground">
        We will send {formatPrice(amount)} back to the card you paid with, once
        someone has read your note.
      </p>
      <fetcher.Form
        method="post"
        action={`/courses/${slug}/refund`}
        className="space-y-2"
      >
        <input type="hidden" name="purchaseId" value={purchaseId} />
        <Textarea
          name="reason"
          rows={3}
          required
          placeholder="What went wrong?"
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Request a refund"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsFormOpen(false)}
          >
            Keep it
          </Button>
        </div>
      </fetcher.Form>
    </div>
  );
}
