import { useState } from "react";
import { useFetcher } from "react-router";
import { Lock, NotebookPen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { cn, formatRelativeTime } from "~/lib/utils";
import { describeNoteDraft } from "~/modules/lesson-notes";

export type SavedNote = { body: string; updatedAt: string };

/** Styled to match the Questions & Discussion card further down the lesson. */
export function LessonNote({ note }: { note: SavedNote | null }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const isSaving = fetcher.state !== "idle";
  const error = fetcher.data?.error;
  const [body, setBody] = useState(note?.body ?? "");
  const draft = describeNoteDraft(body, note?.body ?? null);

  return (
    <Card className="mb-8 gap-0 py-0">
      <CardContent className="p-6">
        <NoteHeader />

        <fetcher.Form method="post" className="space-y-2">
          <input type="hidden" name="intent" value="save-note" />
          <Textarea
            name="body"
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Jot down what you want to remember from this lesson..."
            aria-label="Your notes"
            className="resize-y"
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              size="sm"
              disabled={isSaving || !draft.canSave}
            >
              {isSaving ? "Saving..." : "Save note"}
            </Button>
            <NoteStatus
              error={error}
              dirty={draft.dirty}
              updatedAt={note?.updatedAt}
            />
            <span
              className={cn(
                "ml-auto text-xs",
                draft.tooLong ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {draft.length} / {draft.max}
            </span>
          </div>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

function NoteHeader() {
  return (
    <div className="mb-4 flex items-center gap-2">
      <NotebookPen className="size-5 text-primary" />
      <h2 className="text-xl font-semibold">Your notes</h2>
      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Only you can see these
      </span>
    </div>
  );
}

function NoteStatus({
  error,
  dirty,
  updatedAt,
}: {
  error: string | undefined;
  dirty: boolean;
  updatedAt: string | undefined;
}) {
  if (error) return <span className="text-sm text-destructive">{error}</span>;
  if (dirty)
    return (
      <span className="text-xs text-muted-foreground">Unsaved changes</span>
    );
  if (!updatedAt) return null;
  return (
    <span suppressHydrationWarning className="text-xs text-muted-foreground">
      Saved · edited {formatRelativeTime(updatedAt)}
    </span>
  );
}
