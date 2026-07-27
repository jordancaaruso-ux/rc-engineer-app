"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { COMMENT_MAX_LENGTH } from "@/lib/teams/commentRules";
import { cn } from "@/lib/utils";
import type { TeamFeedComment } from "@/lib/teams/loadTeamFeed";

/**
 * Comments anchored to one run in one team.
 *
 * There is no standalone posting anywhere in the feed — every remark hangs off the run it
 * explains. That is the whole reason this beats the group chat everyone already has: six
 * weeks later the sentence "track came in hard, this isn't the droop" is still attached to
 * the run it was about.
 */
export function TeamCommentThread({
  teamId,
  runId,
  initialComments,
}: {
  teamId: string;
  runId: string;
  /** Edit/delete permissions are resolved server-side and ride along on each comment. */
  initialComments: TeamFeedComment[];
}) {
  const [comments, setComments] = useState<TeamFeedComment[]>(initialComments);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const base = `/api/teams/${encodeURIComponent(teamId)}/comments`;

  async function submit() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, body, parentId: replyTo }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        comment?: TeamFeedComment;
        error?: string;
      };
      if (!res.ok || !data.comment) throw new Error(data.error || "Could not post comment");
      setComments((prev) => [...prev, data.comment!]);
      setDraft("");
      setReplyTo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post comment");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(commentId: string) {
    const body = editDraft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(commentId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        comment?: { body: string; editedAt: string };
        error?: string;
      };
      if (!res.ok || !data.comment) throw new Error(data.error || "Could not save");
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId ? { ...c, body: data.comment!.body, editedAt: data.comment!.editedAt } : c
        )
      );
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(commentId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(commentId)}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { mode?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not delete");
      if (data.mode === "hard") {
        setComments((prev) => prev.filter((c) => c.id !== commentId && c.parentId !== commentId));
      } else {
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId
              ? { ...c, body: "", deletedAt: new Date().toISOString(), viewerCanEdit: false, viewerCanDelete: false }
              : c
          )
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  const roots = comments.filter((c) => !c.parentId);
  const repliesByParent = new Map<string, TeamFeedComment[]>();
  for (const c of comments) {
    if (!c.parentId) continue;
    repliesByParent.set(c.parentId, [...(repliesByParent.get(c.parentId) ?? []), c]);
  }

  return (
    <div className="border-t border-border/60">
      {roots.map((comment) => (
        <div key={comment.id}>
          <CommentRow
            comment={comment}
            isEditing={editingId === comment.id}
            editDraft={editDraft}
            onEditDraft={setEditDraft}
            onStartEdit={() => {
              setEditingId(comment.id);
              setEditDraft(comment.body);
            }}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={() => void saveEdit(comment.id)}
            onDelete={() => void remove(comment.id)}
            onReply={() => setReplyTo(comment.id)}
            busy={busy}
          />
          {(repliesByParent.get(comment.id) ?? []).map((reply) => (
            <CommentRow
              key={reply.id}
              comment={reply}
              nested
              isEditing={editingId === reply.id}
              editDraft={editDraft}
              onEditDraft={setEditDraft}
              onStartEdit={() => {
                setEditingId(reply.id);
                setEditDraft(reply.body);
              }}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={() => void saveEdit(reply.id)}
              onDelete={() => void remove(reply.id)}
              busy={busy}
            />
          ))}
        </div>
      ))}

      <div className="px-4 py-2.5">
        {replyTo ? (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="type-timestamp">Replying in thread</span>
            <button
              type="button"
              className="type-timestamp text-accent underline underline-offset-2"
              onClick={() => setReplyTo(null)}
            >
              Cancel
            </button>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-9 flex-1 resize-y rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-ring"
            rows={1}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder="Add what you saw…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Add a comment"
          />
          <Button onClick={() => void submit()} disabled={busy || !draft.trim()}>
            {busy ? "Posting…" : "Post"}
          </Button>
        </div>
        {error ? <p className="mt-1 text-[12px] text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  nested = false,
  isEditing,
  editDraft,
  onEditDraft,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReply,
  busy,
}: {
  comment: TeamFeedComment;
  nested?: boolean;
  isEditing: boolean;
  editDraft: string;
  onEditDraft: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onReply?: () => void;
  busy: boolean;
}) {
  return (
    <div
      id={`c-${comment.id}`}
      className={cn(
        "scroll-mt-20 border-b border-border/40 px-4 py-2 last:border-b-0",
        nested && "pl-9"
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-semibold text-foreground">{comment.authorLabel}</span>
        <RelativeTime iso={comment.createdAt} fallback="—" display="relative" />
        {comment.editedAt ? <span className="type-timestamp">edited</span> : null}
      </div>

      {comment.deletedAt ? (
        <p className="mt-0.5 text-[13px] italic text-muted-foreground">Comment deleted</p>
      ) : isEditing ? (
        <div className="mt-1 flex items-end gap-2">
          <textarea
            className="min-h-9 flex-1 resize-y rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-[13px] text-foreground focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
            maxLength={COMMENT_MAX_LENGTH}
            value={editDraft}
            onChange={(e) => onEditDraft(e.target.value)}
            aria-label="Edit comment"
          />
          <Button onClick={onSaveEdit} disabled={busy || !editDraft.trim()}>
            Save
          </Button>
          <Button variant="outline" onClick={onCancelEdit} disabled={busy}>
            Cancel
          </Button>
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-snug text-muted-foreground">
          {comment.body}
        </p>
      )}

      {!comment.deletedAt && !isEditing ? (
        <div className="mt-1 flex gap-3">
          {onReply ? (
            <button type="button" className="type-timestamp hover:text-foreground" onClick={onReply}>
              Reply
            </button>
          ) : null}
          {comment.viewerCanEdit ? (
            <button type="button" className="type-timestamp hover:text-foreground" onClick={onStartEdit}>
              Edit
            </button>
          ) : null}
          {comment.viewerCanDelete ? (
            <button type="button" className="type-timestamp hover:text-destructive" onClick={onDelete}>
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
