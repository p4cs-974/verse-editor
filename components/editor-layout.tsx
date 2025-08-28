"use client";

import { useQuery, useMutation } from "convex/react";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import Toolbar from "./toolbar";
import DocumentsSidebar from "./documents-sidebar";
import EditorPanel from "./editor-panel";
import PreviewPanel from "./preview-panel";

/**
 * EditorLayout — composes toolbar, optional documents sidebar, editor and preview.
 * The documents sidebar is toggleable via the toolbar button.
 *
 * Behavior:
 * - If there's no selected document, attempt to select the first existing document for the user.
 * - If the user has no documents and is signed in, create a new default document and select it.
 * - If the user is not signed in, don't attempt to create a document; do nothing.
 */
export default function EditorLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<Id<"documents"> | null>(null);

  // load the selected document (returns null while not selected)
  // When no document is selected pass the "skip" sentinel so the hook doesn't run.
  const selectedDoc = useQuery(
    api.documents.getDocument,
    selectedId ? { documentId: selectedId } : "skip"
  );

  // list user's documents to auto-select or create a new one if needed
  const docs = useQuery(api.documents.listDocumentsForUser, {}) as Array<{
    _id: Id<"documents">;
    title: string;
  }> | null;
  const createDocument = useMutation(api.documents.createDocument);
  const { isSignedIn } = useAuth();

  // prevent duplicate auto-creation
  const creatingRef = useRef(false);

  useEffect(() => {
    // If there's already a selected document, do nothing.
    if (selectedId) return;
    // Wait until docs are loaded (docs can be undefined while loading).
    if (!docs) return;

    // If user has existing documents, select the first one.
    if (docs.length > 0) {
      setSelectedId(docs[0]._id);
      setSidebarOpen(false);
      return;
    }

    // If user is signed in and has no documents, create a new default document once.
    if (isSignedIn && !creatingRef.current) {
      creatingRef.current = true;
      (async () => {
        try {
          const id = await createDocument({
            title: "Untitled",
            markdownContent: "# Untitled\n\n",
            cssContent: "",
          });
          if (id) {
            setSelectedId(id as Id<"documents">);
          }
        } catch (err) {
          console.error("Auto-create document failed", err);
        } finally {
          creatingRef.current = false;
        }
      })();
    }
  }, [docs, selectedId, isSignedIn, createDocument]);

  return (
    <div className="flex flex-col h-screen">
      <Toolbar
        sidebarOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((s) => !s)}
      />
      <div className="flex flex-1 h-[calc(100vh-3.5rem)]">
        {sidebarOpen && (
          <DocumentsSidebar
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setSidebarOpen(false);
            }}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        {/* Editor and Preview split */}
        <div className="flex-1 flex">
          <div className="w-1/2 border-r">
            <EditorPanel doc={selectedDoc} />
          </div>

          <div className="w-1/2">
            <PreviewPanel doc={selectedDoc} />
          </div>
        </div>
      </div>
    </div>
  );
}
