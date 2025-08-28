// This is an orchestrator component that combines the editor and preview panels

import React from "react";
import EditorPanel from "./editor-panel";

export default function EditorLayout() {
  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Editor Panel */}
      <div className="w-1/2 border-r">
        <h2 className="p-4 text-lg font-semibold">Editor</h2>
        <EditorPanel />
        {/* Editor content goes here */}
      </div>

      {/* Preview Panel */}
      <div className="w-1/2">
        <h2 className="p-4 text-lg font-semibold">Preview</h2>
        {/* Preview content goes here */}
      </div>
    </div>
  );
}
