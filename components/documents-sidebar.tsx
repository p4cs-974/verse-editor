"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuth } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export default function DocumentsSidebar({
  selectedId,
  onSelect,
  onClose,
}: {
  selectedId?: Id<"documents"> | null;
  onSelect: (id: Id<"documents">) => void;
  onClose?: () => void;
}) {
  // We cast the query result to a typed array to satisfy the linter/typechecker
  const docs = useQuery(api.documents.listDocumentsForUser, {}) as Array<{
    _id: Id<"documents">;
    title: string;
  }> | null;
  const create = useMutation(api.documents.createDocument);
  const remove = useMutation(api.documents.deleteDocument);
  const updateDoc = useMutation(api.documents.updateDocument);
  // Clerk auth helpers (used to guard create/delete operations and to diagnose token issues)
  const { isSignedIn, getToken } = useAuth();

  const [creatingTitle, setCreatingTitle] = useState("");
  const [editingId, setEditingId] = useState<Id<"documents"> | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  async function handleCreate() {
    const title = creatingTitle.trim() || "Untitled";
    if (!isSignedIn) {
      // Guard on the client to avoid hitting the server when the user isn't signed in.
      // This also provides a clearer UX error than the server exception.
      alert("Please sign in to create a document.");
      return;
    }
    try {
      // Try to obtain a Clerk token (for debugging if auth isn't being forwarded to Convex).
      const token = await getToken().catch(() => null);
      console.debug("Attempting to create document; token present:", !!token);

      const id = await create({
        title,
        markdownContent: `# ${title}\n\n`,
        cssContent: "",
      });
      setCreatingTitle("");
      // select the newly created document
      if (id) onSelect(id as Id<"documents">);
    } catch (e) {
      console.error("Create failed", e);
      alert("Create failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleDelete(id: Id<"documents">) {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    try {
      await remove({ documentId: id });
      if (selectedId === id && onClose) onClose?.();
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
    <aside className="w-64 border-r bg-surface/80 p-3 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Documents</h3>
        <button
          aria-label="Close documents"
          onClick={() => onClose?.()}
          className="text-sm px-2 py-1 rounded hover:bg-muted"
        >
          Close
        </button>
      </div>

      <div className="mb-3">
        <input
          value={creatingTitle}
          onChange={(e) => setCreatingTitle(e.target.value)}
          placeholder="New document title"
          className="w-full px-2 py-1 rounded border bg-background/50"
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleCreate}
            className="px-3 py-1 rounded bg-emerald-500 text-white text-sm"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setCreatingTitle("")}
            className="px-3 py-1 rounded border text-sm"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {!docs && <p className="text-sm text-muted-foreground">Loading…</p>}
        {docs && docs.length === 0 && (
          <p className="text-sm text-muted-foreground">No documents yet.</p>
        )}
        <ul className="space-y-1">
          {docs?.map((d: { _id: Id<"documents">; title: string }) => (
            <li key={d._id}>
              <div className="flex items-center justify-between">
                <div className="flex items-center justify-between gap-2 w-full">
                  <div className="flex-1">
                    {editingId === d._id ? (
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
                    ) : (
                      <button
                        type="button"
                        className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer text-left ${
                          selectedId === d._id
                            ? "bg-emerald-100/30"
                            : "hover:bg-muted"
                        }`}
                        onClick={() => onSelect(d._id)}
                      >
                        <div className="truncate text-sm">{d.title}</div>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {editingId === d._id ? (
                      <>
                        <button
                          type="button"
                          onClick={saveEditing}
                          className="text-xs px-2 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="text-xs px-2 py-1 rounded border"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditing(d._id, d.title)}
                          className="text-xs px-2 py-1 rounded border hover:bg-muted"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${d.title}`}
                          onClick={() => handleDelete(d._id)}
                          className="text-xs text-red-600 px-2 py-1 rounded hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
