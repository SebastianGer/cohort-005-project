export type RenderedComment = {
  id: number;
  /** Raw markdown — only used to populate the edit box. */
  body: string;
  bodyHtml: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  author: {
    id: number;
    name: string;
    avatarUrl: string | null;
    isInstructor: boolean;
    isPlatformAdmin: boolean;
  };
  replies: RenderedComment[];
};
