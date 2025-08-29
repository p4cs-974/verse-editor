"use client";
/* eslint-disable security/detect-dangerouslysetinnerhtml */

import { marked } from "marked";
import createDOMPurify, { type DOMPurify } from "dompurify";
import { useMemo, useId, memo, useRef, useEffect } from "react";

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

function PreviewPanel({ doc, content }: PreviewPanelProps) {
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

  // Reference to the container where sanitized HTML will be injected.
  // We intentionally avoid React's dangerouslySetInnerHTML on every render
  // because replacing the entire innerHTML recreates <img> nodes and forces
  // them to reload. Instead we manage the DOM patching in an effect where
  // we preserve existing <img> elements with the same src to prevent reloads.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevImagesRef = useRef<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Map existing images by their src attribute.
    const existingImgs = Array.from(container.querySelectorAll("img"));
    const imgMap = new Map<string, HTMLImageElement>();
    for (const img of existingImgs) {
      const imageSrc = img.getAttribute("src") ?? "";
      if (imageSrc) imgMap.set(imageSrc, img);
    }

    // Replace the container content with the new sanitized HTML.
    // This will insert new <img> elements; we will swap them out below
    // with preserved image elements when the src matches.
    container.innerHTML = html;

    // After insertion, replace newly-inserted images with preserved ones
    // when possible to avoid reloading the resource.
    const newImgs = Array.from(container.querySelectorAll("img"));
    let preservedCount = 0;
    for (const newImg of newImgs) {
      const s = newImg.getAttribute("src") ?? "";
      const preserved = s ? imgMap.get(s) : undefined;
      if (preserved) {
        preservedCount++;
        try {
          // Copy non-src attributes from the newly inserted image onto the
          // preserved image before moving it. This updates classes, alt,
          // srcset, decoding, etc., without reassigning the preserved src
          // (which can trigger a reload).
          for (let i = 0; i < newImg.attributes.length; i++) {
            const attr = newImg.attributes[i];
            if (attr.name === "src") continue;
            try {
              preserved.setAttribute(attr.name, attr.value);
            } catch {
              // ignore attribute copy errors
            }
          }

          // If the srcs don't match (unexpected), log and keep the preserved
          // src to avoid forcing a re-download. We still move the preserved
          // element into the new DOM position.
          const newSrc = newImg.getAttribute("src") ?? "";
          const preservedSrc = preserved.getAttribute("src") ?? "";
          if (newSrc && newSrc !== preservedSrc) {
            // eslint-disable-next-line no-console
            console.debug(
              "[PreviewPanel] image src mismatch, keeping preserved src",
              {
                newSrc,
                preservedSrc,
              }
            );
          }

          // Move the preserved node into place. Moving the node after copying
          // attributes minimizes the chance of the browser reloading the image.
          newImg.replaceWith(preserved);
        } catch {
          // If replacement fails for any reason, ignore and leave newImg.
        }
      }
    }

    // Rebuild prevImagesRef from the current DOM state.
    const updated: Record<string, HTMLImageElement> = {};
    for (const img of Array.from(container.querySelectorAll("img"))) {
      const s = img.getAttribute("src") ?? "";
      if (s) updated[s] = img;
    }
    prevImagesRef.current = updated;
  }, [html]);

  return (
    <div className="h-full p-4 overflow-auto" data-export-preview>
      {/* Inject document-specific CSS */}
      <style>{css}</style>

      <div
        ref={containerRef}
        className="verse-preview-content prose max-w-none"
        // content is managed by the effect above
      />
    </div>
  );
}

// Memoize the component to prevent unnecessary re-renders when content hasn't changed
export default memo(PreviewPanel, (prevProps, nextProps) => {
  // Skip update when both content and document CSS are unchanged.
  return (
    prevProps.content === nextProps.content &&
    prevProps.doc?.cssContent === nextProps.doc?.cssContent
  );
});
