"use client";

import React from "react";
import { Square, Logs, Trash2, Plus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getUserImagesMap, removeUserImage } from "@/lib/user-images-storage";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

type UserGalleryProps = {
  urls: string[];
  className?: string;
};

function fileNameFromUrl(url: string): string {
  const map = getUserImagesMap();
  const stored = map[url]?.fileName;
  if (stored) return stored;
  try {
    const u = new URL(
      url,
      typeof window !== "undefined" ? window.location.href : "http://localhost"
    );
    const last = u.pathname.split("/").filter(Boolean).pop() || url;
    const i = last.lastIndexOf(".");
    const base = i > 0 ? last.slice(0, i) : last;
    return decodeURIComponent(base);
  } catch {
    const path = url.split("?")[0].split("#")[0];
    const last = path.split("/").filter(Boolean).pop() || url;
    const i = last.lastIndexOf(".");
    const base = i > 0 ? last.slice(0, i) : last;
    try {
      return decodeURIComponent(base);
    } catch {
      return base;
    }
  }
}

function deriveUploadedAt(url: string): number | null {
  // Prefer the local KV map first (object shape: { uploadedAt, fileName? })
  try {
    const map = getUserImagesMap();
    const entry = map[url];
    const n = entry?.uploadedAt;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  } catch {}
  // Fallback: parse from URL query params
  try {
    const u = new URL(
      url,
      typeof window !== "undefined" ? window.location.href : "http://localhost"
    );
    const params = u.searchParams;
    const keys = ["uploadedAt", "uploaded_at", "ts", "t"];
    for (const k of keys) {
      const v = params.get(k);
      if (v) {
        const n = Number(v);
        if (!Number.isNaN(n) && Number.isFinite(n)) return n;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function formatDateTime(ms: number | null): string {
  if (!ms) return "Unknown";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "Unknown";
  }
}

export default function UserGallery({ urls, className }: UserGalleryProps) {
  const deleteUserImages = useAction(api.userImagesActions.deleteUserImages);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [removedUrls, setRemovedUrls] = React.useState<Set<string>>(new Set());
  const [copied, setCopied] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [tab, setTab] = React.useState<string>("panel");
  const [bulkDeleting, setBulkDeleting] = React.useState(false);

  const handleDelete = React.useCallback(
    async (e: React.MouseEvent, url: string) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        setDeleting(url);
        await deleteUserImages({ fileUrls: [url] });
        // Keep local KV in sync for filename/uploadedAt derivations
        removeUserImage(url);
        setRemovedUrls((prev) => new Set(prev).add(url));
      } catch (err) {
        console.error("Failed to delete image", err);
      } finally {
        setDeleting(null);
      }
    },
    [deleteUserImages]
  );

  const copyMarkdown = React.useCallback(async (url: string) => {
    const name = fileNameFromUrl(url);
    const md = `![${name}](${url})`;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = md;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(url);
      window.setTimeout(() => setCopied(null), 1200);
    } catch (err) {
      console.error("Failed to copy markdown", err);
    }
  }, []);

  const copyMarkdownForSelected = React.useCallback(async () => {
    const list = Array.from(selected);
    if (list.length === 0) return;
    const md = list.map((u) => `![${fileNameFromUrl(u)}](${u})`).join("\n\n");
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = md;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch (err) {
      console.error("Failed to copy markdown for selection", err);
    }
  }, [selected]);

  const handleDeleteSelected = React.useCallback(async () => {
    const list = Array.from(selected);
    if (list.length === 0) return;
    try {
      setBulkDeleting(true);
      await deleteUserImages({ fileUrls: list });
      list.forEach((u) => removeUserImage(u));
      setRemovedUrls((prev) => {
        const next = new Set(prev);
        list.forEach((u) => next.add(u));
        return next;
      });
      setSelected(new Set());
    } catch (err) {
      console.error("Failed to delete selected images", err);
    } finally {
      setBulkDeleting(false);
    }
  }, [deleteUserImages, selected]);

  const visibleUrls = React.useMemo(
    () => urls.filter((u) => !removedUrls.has(u)),
    [urls, removedUrls]
  );

  // Selection helpers (list view)
  const allSelected = React.useMemo(
    () => visibleUrls.length > 0 && visibleUrls.every((u) => selected.has(u)),
    [visibleUrls, selected]
  );
  const someSelected = React.useMemo(
    () => !allSelected && visibleUrls.some((u) => selected.has(u)),
    [visibleUrls, selected, allSelected]
  );
  const toggleSelectAll = React.useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(visibleUrls) : new Set());
    },
    [visibleUrls]
  );

  return (
    <div className={cn("flex w-full flex-col", className)}>
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="mb-2 flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="panel">
              <Square className="mr-1" /> Panel
            </TabsTrigger>
            <TabsTrigger value="list">
              <Logs className="mr-1" /> List
            </TabsTrigger>
          </TabsList>
          {tab === "list" && selected.size > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={copyMarkdownForSelected}
                title="Copy markdown for selected"
              >
                <Plus className="mr-1 h-4 w-4" /> Copy MD
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteSelected}
                disabled={bulkDeleting}
                title={bulkDeleting ? "Deleting..." : "Delete selected"}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
            </div>
          )}
        </div>

        <TabsContent value="panel">
          <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-auto p-1">
            {visibleUrls.map((url) => {
              const name = fileNameFromUrl(url);
              return (
                <div
                  key={url}
                  role="button"
                  tabIndex={0}
                  aria-label={`Copy markdown for ${name}`}
                  title="Click to copy markdown"
                  onClick={() => copyMarkdown(url)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      copyMarkdown(url);
                    }
                  }}
                  className="group relative cursor-copy overflow-hidden rounded-lg border bg-background shadow-sm"
                >
                  <div className="relative aspect-[4/3] w-full">
                    {/* Image */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {/* Delete button (shows on hover) */}
                    <button
                      type="button"
                      aria-label="Delete image"
                      onClick={(e) => handleDelete(e, url)}
                      disabled={deleting === url}
                      className={cn(
                        "absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full",
                        "bg-black/60 text-white shadow transition-opacity hover:bg-red-600 focus:outline-none",
                        "opacity-0 group-hover:opacity-100"
                      )}
                      title="Delete"
                    >
                      <Trash2
                        className={cn(
                          "h-4 w-4",
                          deleting === url && "animate-pulse opacity-70"
                        )}
                      />
                    </button>
                    {/* Blurred bottom overlay with fading intensity (25% height) */}
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 backdrop-blur-md"
                      style={{
                        WebkitMaskImage:
                          "linear-gradient(to top, black, transparent)",
                        maskImage:
                          "linear-gradient(to top, black, transparent)",
                      }}
                    />
                    {/* Soft tint for text legibility */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/30 to-transparent" />
                    {/* Filename over the blur */}
                    <div className="absolute inset-x-0 bottom-0 p-2 text-xs font-medium text-white">
                      <div className="line-clamp-1">{name}</div>
                    </div>
                    {/* Copied feedback overlay */}
                    {copied === url && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span className="rounded bg-black/70 px-2 py-1 text-xs text-white">
                          Copied!
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="list">
          <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden rounded-md border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[36px] px-1">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      className="h-4 w-4"
                    />
                  </TableHead>
                  <TableHead className="w-[60px] px-1">Preview</TableHead>
                  <TableHead className="w-[232px] px-1">File name</TableHead>
                  <TableHead className="w-[170px] px-1">Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleUrls.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      No images.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleUrls.map((url) => {
                    const name = fileNameFromUrl(url);
                    const ts = deriveUploadedAt(url);
                    const isChecked = selected.has(url);
                    return (
                      <TableRow key={url}>
                        <TableCell className="w-[36px] px-1">
                          <input
                            type="checkbox"
                            aria-label={`Select ${name}`}
                            checked={isChecked}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(url);
                                else next.delete(url);
                                return next;
                              })
                            }
                            className="h-4 w-4"
                          />
                        </TableCell>
                        <TableCell className="w-[60px] px-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={name}
                            className="h-10 w-10 rounded object-cover"
                            loading="lazy"
                          />
                        </TableCell>
                        <TableCell className="w-[232px] max-w-[232px] overflow-hidden px-1">
                          <span title={name} className="block truncate">
                            {name}
                          </span>
                        </TableCell>
                        <TableCell className="w-[170px] px-1">
                          {formatDateTime(ts)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
