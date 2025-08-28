"use client";
import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { useDebouncedCallback } from "@/lib/useDebouncedSave";
import type { Id } from "../convex/_generated/dataModel";

type DocumentData = {
  _id: Id<"documents">;
  title: string;
  markdownContent: string;
  cssContent?: string | null;
};

export default function EditorPanel({ doc }: { doc?: DocumentData | null }) {
  const [value, setValue] = useState<string>(doc?.markdownContent ?? "");
  const update = useMutation(api.documents.updateDocument);

  // update local state when switching documents or markdown content changes
  useEffect(() => {
    setValue(doc?.markdownContent ?? "");
  }, [doc?.markdownContent]);

  const debouncedSave = useDebouncedCallback(async (newValue: string) => {
    if (!doc?._id) return;
    try {
      await update({
        documentId: doc._id,
        markdownContent: newValue,
      });
    } catch (_e) {
      // swallow; UI could show a toast in the future
      // console.error("Failed to save document", _e);
    }
  }, 800);

  return (
    <div className="h-full">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold">{doc?.title ?? "Untitled"}</h2>
      </div>

      <div className="p-4 h-[calc(100%-4rem)]">
        <CodeMirror
          value={value}
          extensions={[
            markdown({ base: markdownLanguage, codeLanguages: languages }),
          ]}
          theme={"dark"}
          onChange={(val) => {
            setValue(val);
            debouncedSave(val);
          }}
          height="100%"
        />
      </div>
    </div>
  );
}
