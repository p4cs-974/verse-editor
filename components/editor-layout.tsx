"use client";

import { useQuery, useMutation } from "convex/react";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useDebouncedCallback } from "@/lib/useDebouncedSave";
import { DEFAULT_DOCUMENT_CSS } from "@/lib/default-document-styles";
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
  const [localContent, setLocalContent] = useState<string>("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedContent, setLastSavedContent] = useState<string>("");

  // load the selected document (returns null while not selected)
  // When no document is selected pass the "skip" sentinel so the hook doesn't run.
  const selectedDoc = useQuery(
    api.documents.getDocument,
    selectedId ? { documentId: selectedId } : "skip"
  );

  // Track if we're in the middle of a document switch to avoid conflicts
  const documentSwitchingRef = useRef<boolean>(false);

  // Sync database content to local state - only when document changes and no unsaved changes
  useEffect(() => {
    const incomingContent = selectedDoc?.markdownContent ?? "";

    // Skip if no document
    if (!selectedDoc) {
      return;
    }

    console.log("🔄 Document content sync triggered:", {
      documentId: selectedDoc._id,
      incomingContent: incomingContent.slice(0, 50) + "...",
      currentLocalContent: localContent.slice(0, 50) + "...",
      lastSavedContent: lastSavedContent.slice(0, 50) + "...",
      hasUnsavedChanges,
      documentSwitching: documentSwitchingRef.current,
      timestamp: new Date().toISOString(),
    });

    // Only sync from database if:
    // 1. We're switching documents, OR
    // 2. No unsaved changes AND (first load OR content matches last saved)
    const shouldSync =
      documentSwitchingRef.current ||
      (!hasUnsavedChanges &&
        (lastSavedContent === "" || incomingContent === lastSavedContent));

    if (shouldSync) {
      console.log("✅ Syncing database content to local editor");
      setLocalContent(incomingContent);
      setLastSavedContent(incomingContent);
      setHasUnsavedChanges(false);
      documentSwitchingRef.current = false;
    } else if (hasUnsavedChanges) {
      console.warn(
        "⚠️ CONFLICT: Preserving local changes over database content"
      );
    }
  }, [selectedDoc?.markdownContent, selectedDoc?._id]);

  // list user's documents to auto-select or create a new one if needed
  const docs = useQuery(api.documents.listDocumentsForUser, {}) as Array<{
    _id: Id<"documents">;
    title: string;
  }> | null;
  const createDocument = useMutation(api.documents.createDocument);
  const updateDocument = useMutation(api.documents.updateDocument);
  const { isSignedIn } = useAuth();

  // prevent duplicate auto-creation
  const creatingRef = useRef(false);

  // Debounced save function
  const debouncedSave = useDebouncedCallback(async (newValue: string) => {
    if (!selectedId) return;
    console.log("💾 Debounced save triggered:", {
      documentId: selectedId,
      contentPreview: newValue.slice(0, 50) + "...",
      timestamp: new Date().toISOString(),
    });
    try {
      await updateDocument({
        documentId: selectedId,
        markdownContent: newValue,
      });
      console.log("✅ Save completed successfully");
      // Update tracking after successful save
      setLastSavedContent(newValue);
      setHasUnsavedChanges(false);
    } catch (_e) {
      console.error("❌ Save failed:", _e);
      // Keep unsaved changes flag on save failure
    }
  }, 800);

  // Handle content changes
  const handleContentChange = (newValue: string) => {
    console.log("✏️ User typing:", {
      contentPreview: newValue.slice(0, 50) + "...",
      timestamp: new Date().toISOString(),
    });
    setLocalContent(newValue);

    // Mark as having unsaved changes if content differs from last saved
    if (newValue !== lastSavedContent) {
      setHasUnsavedChanges(true);
    }

    debouncedSave(newValue);
  };

  useEffect(() => {
    // If there's already a selected document, do nothing.
    if (selectedId) return;
    // Wait until docs are loaded (docs can be undefined while loading).
    if (!docs) return;

    // If user has existing documents, select the first one.
    if (docs.length > 0) {
      setSelectedId(docs[0]._id);
      setSidebarOpen(false);
      // Reset tracking state when auto-selecting first document
      setHasUnsavedChanges(false);
      setLastSavedContent("");
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
            cssContent: DEFAULT_DOCUMENT_CSS,
          });
          if (id) {
            setSelectedId(id as Id<"documents">);
            // Reset tracking state for new document
            setHasUnsavedChanges(false);
            setLastSavedContent("# Untitled\n\n");
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
              documentSwitchingRef.current = true;
              setSelectedId(id);
              setSidebarOpen(false);
              // Reset tracking state when switching documents
              setHasUnsavedChanges(false);
              setLastSavedContent("");
            }}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        {/* Editor and Preview split */}
        <div className="flex-1 flex">
          <div className="w-1/2 border-r">
            <EditorPanel
              doc={selectedDoc}
              content={localContent}
              onChange={handleContentChange}
            />
          </div>

          <div className="w-1/2">
            <PreviewPanel doc={selectedDoc} content={localContent} />
          </div>
        </div>
      </div>
    </div>
  );
}
