"use client";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
// import { languages } from "@codemirror/language-data";
import type { Id } from "../convex/_generated/dataModel";

type DocumentData = {
  _id: Id<"documents">;
  title: string;
  markdownContent: string;
  cssContent?: string | null;
};

interface EditorPanelProps {
  doc?: DocumentData | null;
  content: string;
  onChange: (newValue: string) => void;
  onBlur?: () => void;
}

export default function EditorPanel({
  doc,
  content,
  onChange,
  onBlur,
}: EditorPanelProps) {
  return (
    <div className="h-full">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold">{doc?.title ?? "Untitled"}</h2>
      </div>

      <div className="p-4 h-[calc(100%-4rem)]">
        <CodeMirror
          value={content}
          extensions={[markdown({ base: markdownLanguage })]}
          theme={"dark"}
          onChange={onChange}
          onBlur={() => onBlur?.()}
          height="100%"
        />
      </div>
    </div>
  );
}
