"use client";

import { useQuery, useMutation } from "convex/react";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useDebouncedCallback } from "@/lib/useDebouncedSave";
import { DEFAULT_DOCUMENT_CSS } from "@/lib/default-document-styles";
import Toolbar from "./toolbar";
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
  const [selectedId, setSelectedId] = useState<Id<"documents"> | null>(null);
  const [localContent, setLocalContent] = useState<string>("");
  const [syncStatus, setSyncStatus] = useState<"local" | "synced">("synced");
  const [lastSyncedContent, setLastSyncedContent] = useState<string>("");

  // Local-first: remember last opened doc id
  const LAST_DOC_KEY = "md-editor:last-doc-id";

  // Retry/backoff and lifecycle guards
  const retryAttemptRef = useRef(0);
  const backoffTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  // Track local draft timestamp for reconciliation/multi-tab
  const localUpdatedAtRef = useRef<number>(0);

  // Helpers for localStorage drafts
  const draftKey = (id: Id<"documents">) => `draft-${id}`;
  const loadDraft = (id: Id<"documents">) => {
    try {
      const raw = localStorage.getItem(draftKey(id));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { content: string; updatedAt: number };
      if (
        typeof parsed?.content === "string" &&
        typeof parsed?.updatedAt === "number"
      ) {
        return parsed;
      }
    } catch {
      // ignore parse errors
    }
    return null;
  };
  const saveDraft = (id: Id<"documents">, content: string) => {
    const updatedAt = Date.now();
    localStorage.setItem(draftKey(id), JSON.stringify({ content, updatedAt }));
    localUpdatedAtRef.current = updatedAt;
    return updatedAt;
  };

  // Local-first hydrate: pick last selected doc immediately (before Convex responds)
  useEffect(() => {
    if (selectedId) return;
    try {
      const last = localStorage.getItem(LAST_DOC_KEY);
      if (last) {
        setSelectedId(last as Id<"documents">);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load the selected document (returns null while not selected)
  // When no document is selected pass the "skip" sentinel so the hook doesn't run.
  const selectedDoc = useQuery(
    api.documents.getDocument,
    selectedId ? { documentId: selectedId } : "skip"
  );

  // Track if we're in the middle of a document switch to avoid conflicts
  const documentSwitchingRef = useRef<boolean>(false);

  // list user's documents to auto-select or create a new one if needed
  const docs = useQuery(api.documents.listDocumentsForUser, {}) as Array<{
    _id: Id<"documents">;
    title: string;
  }> | null;
  const createDocument = useMutation(api.documents.createDocument);
  const updateDocument = useMutation(api.documents.updateDocument);
  const { isSignedIn } = useAuth();

  // persist current document css to localStorage whenever it changes
  useEffect(() => {
    if (!selectedId) return;
    try {
      const css = selectedDoc?.cssContent ?? "";
      localStorage.setItem(`md-editor:css-raw:${selectedId}`, css);
    } catch {}
  }, [selectedId, selectedDoc?.cssContent]);

  // prevent duplicate auto-creation
  const creatingRef = useRef(false);

  // (moved) Lifecycle guard effect is defined after saveHandle

  // When a document is selected, load draft immediately for instant UI
  useEffect(() => {
    if (!selectedId) return;
    const draft = loadDraft(selectedId as Id<"documents">);
    if (draft) {
      localUpdatedAtRef.current = draft.updatedAt;
      setLocalContent(draft.content);
      setSyncStatus(draft.content === lastSyncedContent ? "synced" : "local");
    }
  }, [selectedId, lastSyncedContent]);

  // Guard: only sync when we have the server doc loaded for the selected id
  const canSync = !!(
    selectedId &&
    selectedDoc &&
    selectedDoc._id === selectedId
  );

  // Debounced save function with backoff + lifecycle guards
  const saveHandle = useDebouncedCallback(async (newValue: string) => {
    if (!selectedId) return;
    if (!canSync) return; // wait for Convex to load the document before saving

    // Cancel any scheduled backoff retry before a fresh save
    if (backoffTimerRef.current) {
      window.clearTimeout(backoffTimerRef.current);
      backoffTimerRef.current = null;
    }

    try {
      await updateDocument({
        documentId: selectedId,
        markdownContent: newValue,
      });

      // On success update synced markers
      setLastSyncedContent(newValue);
      setSyncStatus("synced");
      retryAttemptRef.current = 0;
    } catch (err) {
      // Keep local status and back off retries
      const attempt = (retryAttemptRef.current = retryAttemptRef.current + 1);
      const base = 500; // ms
      const cap = 8000; // ms
      const jitter = Math.random() * 200;
      const delay = Math.min(cap, base * Math.pow(2, attempt)) + jitter;

      // Non-intrusive console warning
      console.warn(
        "Save failed, will retry with backoff",
        { attempt, delayMs: Math.round(delay) },
        err
      );

      // Schedule a retry if still mounted
      if (mountedRef.current) {
        backoffTimerRef.current = window.setTimeout(() => {
          // Re-enqueue save with latest content
          saveHandle.call(localContent);
        }, delay) as unknown as number;
      }
    }
  }, 800);

  // lifecycle guard: mark mounted/unmounted and cleanup timers
  useEffect(() => {
    mountedRef.current = true;
    const onWindowBlur = () => {
      // Flush pending save on window blur
      saveHandle.flush();
    };
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      mountedRef.current = false;
      saveHandle.cancel();
      if (backoffTimerRef.current) {
        window.clearTimeout(backoffTimerRef.current);
        backoffTimerRef.current = null;
      }
    };
  }, [saveHandle]);

  // Reconcile local draft with server when the selected document changes
  useEffect(() => {
    if (!selectedId || !selectedDoc) return;

    const draft = loadDraft(selectedId as Id<"documents">);
    if (draft) {
      localUpdatedAtRef.current = draft.updatedAt;
      // Prefer local draft for instant UI
      if (localContent !== draft.content) {
        setLocalContent(draft.content);
      }
      if (draft.content === (selectedDoc.markdownContent ?? "")) {
        setLastSyncedContent(draft.content);
        setSyncStatus("synced");
      } else {
        setSyncStatus("local");
        // Ensure we attempt to sync latest local to server
        saveHandle.cancel();
        saveHandle.call(draft.content);
      }
    } else {
      const server = selectedDoc.markdownContent ?? "";
      setLocalContent(server);
      setLastSyncedContent(server);
      setSyncStatus("synced");
      if (selectedId) saveDraft(selectedId as Id<"documents">, server);
    }

    documentSwitchingRef.current = false;
  }, [selectedId, selectedDoc?._id, selectedDoc?.markdownContent, saveHandle]);

  // Multi-tab sync: listen to storage updates from other tabs
  useEffect(() => {
    if (!selectedId) return;
    const handler = (e: StorageEvent) => {
      if (e.key !== draftKey(selectedId as Id<"documents">)) return;
      try {
        const parsed = e.newValue ? JSON.parse(e.newValue) : null;
        if (!parsed) return;
        const { content, updatedAt } = parsed as {
          content: string;
          updatedAt: number;
        };
        if (typeof content !== "string" || typeof updatedAt !== "number") {
          return;
        }
        if (updatedAt > localUpdatedAtRef.current) {
          localUpdatedAtRef.current = updatedAt;
          setLocalContent(content);
          const nowSynced = content === lastSyncedContent;
          setSyncStatus(nowSynced ? "synced" : "local");
          // Cancel current pending save and reschedule if needed
          saveHandle.cancel();
          if (!nowSynced) {
            saveHandle.call(content);
          }
        }
      } catch {
        // ignore parse errors
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [selectedId, lastSyncedContent, saveHandle]);

  // Handle content changes
  const handleContentChange = (newValue: string) => {
    setLocalContent(newValue);

    // Persist immediately to localStorage
    if (selectedId) {
      saveDraft(selectedId as Id<"documents">, newValue);
    }

    // Status reflects local-only changes (blue) until server confirms
    if (newValue !== lastSyncedContent) {
      setSyncStatus("local");
    }

    // Debounced save to server (only if we can sync)
    if (canSync) {
      saveHandle.call(newValue);
    }
  };

  // When Convex docs load, validate the preloaded selectedId.
  useEffect(() => {
    if (!docs) return;

    // If there's already a selected document and it's valid, keep it.
    if (selectedId && docs.some((d) => d._id === selectedId)) {
      return;
    }

    // If no valid selection, choose the first existing doc.
    if (docs.length > 0) {
      const firstId = docs[0]._id;
      setSelectedId(firstId);
      try {
        localStorage.setItem(LAST_DOC_KEY, firstId as unknown as string);
      } catch {}
      documentSwitchingRef.current = true;
      return;
    }

    // If user is signed in and has no documents, create a new default document once.
    if (!selectedId && isSignedIn && !creatingRef.current) {
      creatingRef.current = true;
      (async () => {
        try {
          const initial = "# Untitled\n\n";
          const id = await createDocument({
            title: "Untitled",
            markdownContent: initial,
            cssContent: DEFAULT_DOCUMENT_CSS,
          });
          if (id) {
            const casted = id as Id<"documents">;
            setSelectedId(casted);
            try {
              localStorage.setItem(LAST_DOC_KEY, casted as unknown as string);
            } catch {}
            documentSwitchingRef.current = true;

            // Persist default CSS to localStorage for this document (per-document key).
            // We store an empty map so the sidebar hydrates from cssContent on first open.
            try {
              localStorage.setItem(
                `md-editor:user-css:${casted}`,
                JSON.stringify({})
              );
              localStorage.setItem(
                `md-editor:css-raw:${casted}`,
                DEFAULT_DOCUMENT_CSS
              );
            } catch {}

            // Seed localStorage and local state
            saveDraft(casted, initial);
            setLocalContent(initial);
            setLastSyncedContent(initial);
            setSyncStatus("synced");
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
        documentId={selectedId}
        cssContent={selectedDoc?.cssContent ?? null}
        markdownContent={selectedDoc?.markdownContent ?? null}
        syncStatus={syncStatus}
        onSelectDocument={(id) => {
          // Cancel any pending save for current doc before switching
          saveHandle.cancel();
          if (backoffTimerRef.current) {
            window.clearTimeout(backoffTimerRef.current);
            backoffTimerRef.current = null;
          }
          documentSwitchingRef.current = true;
          setSelectedId(id);
          try {
            localStorage.setItem(LAST_DOC_KEY, id as unknown as string);
          } catch {}
          // popover closes itself via onClose
        }}
      />
      <div className="flex flex-1 h-[calc(100vh-3.5rem)]">
        {/* Editor and Preview split */}
        <div className="flex-1 flex min-w-0">
          <div className="w-1/2 border-r">
            <EditorPanel
              doc={selectedDoc}
              content={localContent}
              onChange={handleContentChange}
              onBlur={() => saveHandle.flush()}
            />
          </div>

          <div className="w-1/2 relative min-w-0">
            <PreviewPanel doc={selectedDoc} content={localContent} />
            {/* removed old sidebar */}
          </div>
        </div>
      </div>
    </div>
  );
}
