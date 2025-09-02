"use client";

import { useState, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuth } from "@clerk/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEFAULT_DOCUMENT_CSS } from "@/lib/default-document-styles";
import { Button } from "./button";
import { threadId } from "worker_threads";

export default function DocumentsPopoverContent({
  selectedId,
  onSelect,
  onClose,
}: {
  selectedId?: Id<"documents"> | null;
  onSelect: (id: Id<"documents">) => void;
  onClose?: () => void;
}) {
  const docs = useQuery(api.documents.listDocumentsForUser, {}) as Array<{
    _id: Id<"documents">;
    title: string;
  }> | null;
  const create = useMutation(api.documents.createDocument);
  const remove = useMutation(api.documents.deleteDocument);
  const createMarkdownThread = useMutation(api.chat.createMarkdownThread);
  const updateDoc = useMutation(api.documents.updateDocument);
  const { isSignedIn, getToken } = useAuth();

  const [creatingTitle, setCreatingTitle] = useState("");
  const [editingId, setEditingId] = useState<Id<"documents"> | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  async function handleCreate() {
    const title = creatingTitle.trim() || "Untitled";
    if (!isSignedIn) {
      alert("Please sign in to create a document.");
      return;
    }
    try {
      const threadId = await createMarkdownThread();
      const token = await getToken().catch(() => null);
      console.debug("Attempting to create document; token present:", !!token);

      const id = await create({
        title,
        markdownContent: `# ${title}\n\n`,
        cssContent: DEFAULT_DOCUMENT_CSS,
        threadId: threadId,
      });
      setCreatingTitle("");
      if (id) {
        try {
          localStorage.setItem(`md-editor:user-css:${id}`, JSON.stringify({}));
        } catch {}
        onSelect(id as Id<"documents">);
        onClose?.();
      }
    } catch (e) {
      console.error("Create failed", e);
      alert("Create failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleDelete(id: Id<"documents">) {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    try {
      await remove({ documentId: id });
      if (selectedId === id) onClose?.();
    } catch (e) {
      console.error("Delete failed", e);
    }
  }

  function startEditing(id: Id<"documents">, currentTitle: string) {
    setEditingId(id);
    setEditingTitle(currentTitle);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingTitle("");
  }

  async function saveEditing() {
    if (!editingId) return;
    const newTitle = editingTitle.trim() || "Untitled";
    try {
      await updateDoc({ documentId: editingId, title: newTitle });
      setEditingId(null);
      setEditingTitle("");
    } catch (e) {
      console.error("Rename failed", e);
      alert("Rename failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div className="w-[420px] max-w-[90vw] p-3">
      <div className="flex items-center justify-between mb-2">
        <strong>Documents</strong>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close"
          onClick={() => onClose?.()}
        >
          Close
        </Button>
      </div>

      <div className="mb-3">
        <input
          value={creatingTitle}
          onChange={(e) => setCreatingTitle(e.target.value)}
          placeholder="New document title"
          className="w-full px-2 py-1 rounded border bg-background/50"
        />
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={handleCreate}>
            Create
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreatingTitle("")}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="max-h-[45vh] overflow-y-auto rounded-md">
        {!docs && <p className="text-sm text-muted-foreground">Loading…</p>}
        {docs && docs.length === 0 && (
          <p className="text-sm text-muted-foreground">No documents yet.</p>
        )}
        <ul className="space-y-2">
          {docs?.map((d: { _id: Id<"documents">; title: string }) => (
            <li key={d._id} className="space-y-2">
              {editingId === d._id ? (
                <>
                  <input
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditing();
                      if (e.key === "Escape") cancelEditing();
                    }}
                    autoFocus
                    className="w-full px-2 py-1 rounded border bg-background/50 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" onClick={saveEditing}>
                      Save
                    </Button>
                    <Button variant="outline" size="sm" onClick={cancelEditing}>
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Button
                    variant={selectedId === d._id ? "secondary" : "ghost"}
                    className="w-full justify-start h-auto p-2 text-left font-normal min-h-[2.5rem] overflow-hidden"
                    onClick={() => {
                      onSelect(d._id);
                      onClose?.();
                    }}
                  >
                    <span className="text-sm leading-tight w-full block break-words whitespace-normal">
                      {d.title}
                    </span>
                  </Button>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startEditing(d._id, d.title)}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Delete ${d.title}`}
                      onClick={() => handleDelete(d._id)}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
