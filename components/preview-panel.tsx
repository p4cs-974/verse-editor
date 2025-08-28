"use client";
/* eslint-disable security/detect-dangerouslysetinnerhtml */

import { marked } from "marked";
import createDOMPurify, { type DOMPurify } from "dompurify";
import { useMemo, useId } from "react";

/**
 * Preview renderer for editor documents using marked + DOMPurify.
 * - GFM and soft line breaks enabled.
 * - Sanitization via DOMPurify with safe link targets and lazy images.
 */

type DocumentData = {
  markdownContent?: string;
  cssContent?: string;
};

interface PreviewPanelProps {
  doc?: DocumentData | null;
  content: string;
}

// Configure marked
marked.setOptions({
  gfm: true,
  breaks: true,
});

export default function PreviewPanel({ doc, content }: PreviewPanelProps) {
  const purifier = useMemo<DOMPurify>(() => {
    const p = createDOMPurify(window);
    // Harden links and images after sanitization
    p.addHook("afterSanitizeAttributes", (node: any) => {
      if (!node || typeof node !== "object" || !("tagName" in node)) return;
      const el = node as Element;
      if (el.tagName === "A") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      if (el.tagName === "IMG") {
        el.setAttribute("loading", "lazy");
        el.setAttribute("decoding", "async");
      }
    });

    // Block unsafe URL protocols for href/src
    p.addHook("uponSanitizeAttribute", (_node: any, data: any) => {
      if (data && (data.attrName === "href" || data.attrName === "src")) {
        const val = String(data.attrValue || "");
        const safe = /^(https?:|mailto:|tel:|data:image\/)/i.test(val);
        if (!safe) {
          data.keepAttr = false;
          data.attrValue = "";
        }
      }
    });

    return p;
  }, []);

  const raw = content || "";
  const generated = raw
    ? (marked.parse(raw) as string)
    : "<p>No document selected.</p>";

  // Sanitize HTML to prevent XSS
  const html = purifier.sanitize(generated);

  const css = doc?.cssContent ?? "";

  return (
    <div className="h-full p-4 overflow-auto">
      {/* Inject document-specific CSS */}
      <style>{css}</style>

      <div
        className="verse-preview-content prose max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
