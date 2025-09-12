"use client";

import React, { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css";
import { Button } from "@/components/ui/button";
import { TagCombobox, type TagOption } from "@/components/ui/combobox";
import FontUtility from "./font-utility";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Keys
const LS_PREFIX = "md-editor:user-css:";
const RAW_PREFIX = "md-editor:css-raw:";

// Types
type CssMap = Record<string, string>;

const DEFAULT_TAGS: TagOption[] = [
  { value: "p", label: "Text (paragraph)" },
  { value: "h1", label: "Heading 1 (#)" },
  { value: "h2", label: "Heading 2 (##)" },
  { value: "h3", label: "Heading 3 (###)" },
  { value: "code", label: "Inline code (`)" },
  { value: "pre", label: "Code block (```)" },
  { value: "a", label: "Link ([])" },
  { value: "ul, ol", label: "Lists (ul, ol)" },
  { value: "li", label: "List item (li)" },
  { value: "table", label: "Table" },
  { value: "th", label: "Table header" },
  { value: "td", label: "Table data" },
  { value: "blockquote", label: "Blockquote" },
  { value: "body", label: "Document body" },
];

function escapeForRegex(sel: string) {
  return sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadCssMap(key: string): CssMap {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as CssMap;
  } catch {}
  return {};
}

function saveCssMap(key: string, map: CssMap) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}

function extractBlockFromCss(selector: string, cssText: string): string | null {
  try {
    const selEsc = escapeForRegex(selector);
    const pattern = new RegExp(
      `(?:\\.verse-preview-content\\s+)?${selEsc}(?:\\s*,\\s*(?:\\.verse-preview-content\\s+)?[^,{]+)*\\s*\\{[\\s\\S]*?\\}`,
      "m"
    );
    const m = cssText.match(pattern);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

function scopeCssBlock(block: string): string {
  const i = block.indexOf("{");
  if (i === -1) return block;
  const head = block.slice(0, i).trim();
  const body = block.slice(i);
  const scoped = head
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s.startsWith(".verse-preview-content")
        ? `.verse-preview-content.prose ${s.replace(
            /^\.verse-preview-content\s+/,
            ""
          )}`
        : `.verse-preview-content.prose ${s}`
    )
    .join(", ");
  return `${scoped} ${body}`;
}

function unscopeCssBlock(block: string): string {
  const i = block.indexOf("{");
  if (i === -1) return block;
  const head = block.slice(0, i).trim();
  const body = block.slice(i);
  const un = head
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s.startsWith(".verse-preview-content.prose ")
        ? s.replace(/^\.verse-preview-content\.prose\s+/, "")
        : s.startsWith(".verse-preview-content ")
        ? s.replace(/^\.verse-preview-content\s+/, "")
        : s
    )
    .join(", ");
  return `${un} ${body}`;
}

function managedSelectors(options: TagOption[]): string[] {
  const out: string[] = [];
  for (const o of options) {
    String(o.value)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => out.push(s));
  }
  return Array.from(new Set(out));
}

function stripManagedBlocks(cssText: string, options: TagOption[]): string {
  if (!cssText) return cssText;
  let out = cssText;
  const sels = managedSelectors(options);
  for (const sel of sels) {
    const selEsc = escapeForRegex(sel);
    const blockRe = new RegExp(
      `(?:^|\n|\r)\s*(?:\\.verse-preview-content\\s+)?${selEsc}(?:\s*,\s*(?:\\.verse-preview-content\\s+)?[^,{]+)*\s*\\{[\\s\\S]*?\\}`,
      "g"
    );
    out = out.replace(blockRe, "\n");
  }
  return out;
}

function extractBasePreviewBlock(cssText: string): string | null {
  try {
    const re = /\.verse-preview-content\s*\{[\s\S]*?\}/m;
    const m = cssText.match(re);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

function removeBasePreviewBlock(cssText: string): string {
  try {
    return cssText.replace(/\.verse-preview-content\s*\{[\s\S]*?\}/m, "\n");
  } catch {
    return cssText;
  }
}

export default function StylingPopoverContent({
  documentId,
  cssContent,
  onClose,
}: {
  documentId?: Id<"documents"> | null;
  cssContent?: string | null;
  onClose?: () => void;
}) {
  const [tags] = useState<TagOption[]>(DEFAULT_TAGS);
  const [selected, setSelected] = useState<string>(tags[0]?.value || "p");
  const [currentFontFamily, setCurrentFontFamily] = useState<string>("");
  const [cssMap, setCssMap] = useState<CssMap>({});
  const [value, setValue] = useState<string>("");

  const updateDocument = useMutation(api.documents.updateDocument);

  const storageKey = useMemo(
    () => `${LS_PREFIX}${documentId ?? "global"}`,
    [documentId]
  );

  useEffect(() => {
    const map = loadCssMap(storageKey);
    if (Object.keys(map).length === 0 && cssContent) {
      const hydrated: CssMap = {};
      for (const t of tags) {
        const block = extractBlockFromCss(t.value, cssContent);
        if (block) hydrated[t.value] = unscopeCssBlock(block);
      }
      setCssMap(hydrated);
      saveCssMap(storageKey, hydrated);
      try {
        if (documentId)
          localStorage.setItem(`${RAW_PREFIX}${documentId}`, cssContent);
      } catch {}
    } else {
      const normalized: CssMap = {};
      for (const [k, v] of Object.entries(map)) {
        normalized[k] = typeof v === "string" ? unscopeCssBlock(v) : (v as any);
      }
      setCssMap(normalized);
      try {
        if (documentId && cssContent)
          localStorage.setItem(`${RAW_PREFIX}${documentId}`, cssContent);
      } catch {}
    }
  }, [storageKey, cssContent, tags, documentId]);

  useEffect(() => {
    const current = cssMap[selected] ?? defaultTemplateFor(selected);
    setValue(current);

    // Parse current font-family from value
    const fontMatch = current.match(/font-family:\s*([^;]+);/i);
    setCurrentFontFamily(fontMatch ? fontMatch[1].trim() : "");
  }, [selected, cssMap]);

  useEffect(() => {
    const fn = (e: StorageEvent) => {
      if (e.key !== storageKey) return;
      try {
        const parsed = e.newValue ? (JSON.parse(e.newValue) as CssMap) : {};
        setCssMap(parsed || {});
      } catch {}
    };
    window.addEventListener("storage", fn);
    return () => window.removeEventListener("storage", fn);
  }, [storageKey]);

  const aggregateCss = (map: CssMap) =>
    Object.values(map)
      .filter(Boolean)
      .map((b) => scopeCssBlock(b))
      .join("\n\n");

  const apply = async () => {
    const next: CssMap = { ...cssMap, [selected]: value };
    setCssMap(next);
    saveCssMap(storageKey, next);

    if (documentId) {
      try {
        const aggregated = aggregateCss(next);
        const currentRaw =
          (typeof window !== "undefined"
            ? localStorage.getItem(`${RAW_PREFIX}${documentId}`) || ""
            : "") ||
          cssContent ||
          "";

        const baseBlock = extractBasePreviewBlock(currentRaw) || "";
        const withoutManaged = stripManagedBlocks(currentRaw, tags);
        const baseStripped = removeBasePreviewBlock(withoutManaged);

        const parts = [
          baseBlock.trim(),
          baseStripped.trim(),
          aggregated.trim(),
        ].filter(Boolean);
        let finalCss = parts.join("\n\n");

        // Detect font-family declarations in the managed blocks and ensure Google Fonts @import lines
        try {
          const familySet = new Set<string>();
          for (const block of Object.values(next)) {
            if (!block) continue;
            const matches = block.match(/font-family:\s*([^;]+);/gi);
            if (!matches) continue;
            for (const m of matches) {
              const valMatch = /font-family:\s*([^;]+);/i.exec(m);
              if (!valMatch) continue;
              const rawVal = valMatch[1].trim();
              const primary = rawVal.split(",")[0].trim().replace(/['"]/g, "");
              if (primary) familySet.add(primary);
            }
          }

          // Also check any remaining font-family declarations already in baseStripped
          const extraMatches = baseStripped.match(/font-family:\s*([^;]+);/gi);
          if (extraMatches) {
            for (const m of extraMatches) {
              const valMatch = /font-family:\s*([^;]+);/i.exec(m);
              if (!valMatch) continue;
              const rawVal = valMatch[1].trim();
              const primary = rawVal.split(",")[0].trim().replace(/['"]/g, "");
              if (primary) familySet.add(primary);
            }
          }

          // Filter out obvious system fonts that don't need import
          const systemFonts = new Set([
            "Arial",
            "Helvetica",
            "Times New Roman",
            "Courier New",
            // Allow "Inter" to be imported from Google Fonts, so do not include it here
            // "Inter",
            "Georgia",
            "Verdana",
            "Trebuchet MS",
            "Lucida Sans",
          ]);

          // Only consider families that are not obvious system fonts
          const googleFamilies = Array.from(familySet).filter(
            (f) => !systemFonts.has(f)
          );

          // Remove any existing Google Fonts @import lines first so we always inject
          // a canonical, correctly-encoded set of imports. This avoids keeping
          // malformed or duplicated imports that may prevent font loading.
          try {
            finalCss = finalCss.replace(
              /@import\s+url\(['"]https:\/\/fonts\.googleapis\.com\/css2\?family=[^'"]+['"]\);\s*/gi,
              ""
            );
            // Also remove any legacy @import lines that use fonts.googleapis.com without css2 token
            finalCss = finalCss.replace(
              /@import\s+url\(['"]https:\/\/fonts\.googleapis\.com\/[^'"]+['"]\);\s*/gi,
              ""
            );
          } catch {
            // ignore replace errors
          }

          const importLines: string[] = [];
          for (const family of googleFamilies) {
            // Normalize family name and build a Google Fonts family token:
            // - Trim whitespace
            // - Replace multiple internal spaces with single spaces
            // - encodeURIComponent then convert %20 to '+'
            const familyNorm = String(family).trim().replace(/\s+/g, " ");
            const token = encodeURIComponent(familyNorm).replace(/%20/g, "+");
            const importLine = `@import url('https://fonts.googleapis.com/css2?family=${token}&display=swap');`;

            // If there's an explicit @font-face rule for this family we won't add an import,
            // but we've already removed existing @import lines above so this check is mostly
            // defensive against custom @font-face declarations in the document CSS.
            const fontFaceRe = new RegExp(
              `@font-face[\\s\\S]*?font-family\\s*:\\s*['"]?${escapeForRegex(
                familyNorm
              )}['"]?`,
              "i"
            );

            if (!fontFaceRe.test(finalCss)) {
              importLines.push(importLine);
            }
          }

          if (importLines.length > 0) {
            finalCss = importLines.join("\n") + "\n\n" + finalCss;
          }
        } catch (impErr) {
          console.warn("Failed to compute font imports", impErr);
        }
        await updateDocument({ documentId, cssContent: finalCss });
      } catch (e) {
        console.warn("Failed to update document CSS", e);
      }
    }
  };

  function onKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const insideCM = !!target?.closest?.(".cm-editor, .cm-content");
    if (e.key === "Enter" && !insideCM) {
      e.preventDefault();
      apply();
      return;
    }
    if (e.key === "Enter" && insideCM && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      apply();
    }
  }

  return (
    <div className="w-[420px] max-w-[90vw] p-3" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between mb-2">
        <strong>Styles</strong>
        <Button variant="ghost" size="sm" onClick={() => onClose?.()}>
          Close
        </Button>
      </div>

      <div className="mb-2">
        <TagCombobox
          value={selected}
          onChange={(v) => setSelected(v)}
          options={tags}
          label="Element"
        />

        <div className="mt-3">
          <FontUtility
            value={currentFontFamily}
            onSelect={(family) => {
              const newFamilyRule = `font-family: "${family}", sans-serif !important;`;
              let newValue = value;
              const fontMatch = newValue.match(/font-family:\s*([^;]+);/i);
              if (fontMatch) {
                // Replace existing
                newValue = newValue.replace(
                  /font-family:\s*[^;]+;?/i,
                  newFamilyRule
                );
              } else {
                // Add after first { or at end
                const braceIndex = newValue.indexOf("{");
                if (braceIndex !== -1) {
                  newValue =
                    newValue.slice(0, braceIndex + 1) +
                    `\n  ${newFamilyRule}\n` +
                    newValue.slice(braceIndex + 1);
                } else {
                  newValue += `\n  ${newFamilyRule}`;
                }
              }
              setValue(newValue);
              setCurrentFontFamily(family);
            }}
          />
        </div>
      </div>

      <div className="border rounded overflow-hidden bg-background">
        <CodeMirror
          value={value}
          theme="dark"
          extensions={[css()]}
          onChange={setValue}
          height="220px"
        />
      </div>

      <div className="mt-2 flex justify-end">
        <Button onClick={apply} title="Apply (Enter or Cmd/Ctrl+Enter)">
          Apply
        </Button>
      </div>
    </div>
  );
}

function defaultTemplateFor(selector: string) {
  return `${selector} {\n  /* Add styles here */\n}`;
}
