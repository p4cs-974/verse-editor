"use client";
/* eslint-disable security/detect-dangerouslysetinnerhtml */

import { marked } from "marked";
import createDOMPurify, { type DOMPurify } from "dompurify";
import { useMemo, useId, memo, useRef, useEffect } from "react";
import markedKatex from "marked-katex-extension";
import katex from "katex";

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
const renderer = new marked.Renderer();

/**
 * Escape HTML special characters in a string.
 *
 * Converts &, <, >, " and ' to their corresponding HTML entities so the
 * returned string can be safely embedded into HTML content (e.g., inside
 * a <pre> or text node) without being interpreted as markup.
 *
 * @param str - The input text to escape.
 * @returns The escaped string with HTML special characters replaced by entities.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Custom code renderer:
// - For ```mermaid fences, emit a <pre class="mermaid"> with escaped text content.
// - For other languages, fall back to a simple code block (no syntax highlighting).
(renderer as any).code = ({
  text,
  lang,
}: {
  text: string;
  lang?: string;
}): string => {
  const language = (lang || "").trim().split(/\s+/)[0].toLowerCase();
  if (language === "mermaid") {
    // Will be converted to SVG by Mermaid after sanitized HTML insertion
    return `<pre class="mermaid">${escapeHtml(text)}</pre>\n`;
  }
  const classAttr = language ? ` class="language-${escapeHtml(language)}"` : "";
  return `<pre><code${classAttr}>${escapeHtml(text)}</code></pre>\n`;
};

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer,
});

// Register KaTeX extension for inline $...$ and block $$...$$ math.
// Keep errors non-throwing and output as HTML for DOMPurify to sanitize.
marked.use(
  // Cast as any to accommodate types across marked/extension versions.
  (markedKatex as any)({
    throwOnError: false,
    output: "html", // avoid MathML to reduce sanitize friction
    katex, // explicitly pass the KaTeX instance
  }) as any
);
// Debug registration to verify plugin is active during dev
if (process.env.NODE_ENV === "development") {
  console.debug("[preview-panel] marked-katex-extension registered");
}

/**
 * Renders sanitized HTML preview of Markdown content with client-side Mermaid and KaTeX rendering.
 *
 * Generates HTML from the provided Markdown, sanitizes it with a DOMPurify instance that hardens links/images
 * and blocks unsafe URL schemes, and injects the sanitized output into a managed container. Preserves existing
 * <img> elements by src to avoid unnecessary reloads when content updates. After insertion, Mermaid code fences
 * are rendered to SVG and KaTeX auto-rendering is applied for remaining math expressions.
 *
 * The component also injects optional document CSS from the `doc` prop.
 *
 * @returns A React element containing the live preview.
 */
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
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const createdElements: Element[] = [];

    const run = async () => {
      const blocks = Array.from(
        container.querySelectorAll<HTMLElement>(".mermaid")
      );
      if (blocks.length === 0) return;

      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

      let idx = 0;
      for (const el of blocks) {
        const source = el.textContent ?? "";
        const id = `mermaid-${Date.now()}-${idx++}`;
        try {
          const { svg } = await mermaid.render(id, source);
          if (cancelled) return;
          // Replace the placeholder block with the rendered SVG.
          const wrapper = document.createElement("div");
          wrapper.innerHTML = svg;
          const svgElement = wrapper.firstElementChild;
          if (svgElement) {
            el.replaceWith(svgElement);
            createdElements.push(svgElement);
          }
        } catch {
          // Leave original block if rendering fails.
        }
      }
    };

    if (typeof window !== "undefined") {
      void run();
    }

    return () => {
      cancelled = true;
      // Clean up created elements if needed
      createdElements.forEach((el) => el.remove());
    };
  }, [html]);

  // After sanitized HTML is inserted, attempt client-side KaTeX auto-render.
  // This complements marked-katex-extension and avoids double processing if it already ran.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    (async () => {
      try {
        const mod = await import("katex/contrib/auto-render");
        if (cancelled) return;
        const renderMathInElement = mod.default;
        if (typeof renderMathInElement !== "function") {
          return;
        }
        // Wrap KaTeX debug logs in development-only checks
        if (process.env.NODE_ENV === "development") {
          console.debug("[preview-panel] KaTeX auto-render start");
        }
        renderMathInElement(container, {
          delimiters: [
            { left: "$", right: "$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
          ],
          throwOnError: false,
          strict: "ignore",
          ignoredTags: ["script", "noscript", "style", "textarea"],
          ignoredClasses: ["mermaid"],
        });
        if (process.env.NODE_ENV === "development") {
          console.debug("[preview-panel] KaTeX auto-render done");
        }
      } catch (e) {
        console.warn("[preview-panel] KaTeX auto-render error", e);
      }
    })();

    return () => {
      cancelled = true;
    };
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
