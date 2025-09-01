import { useMutation } from "convex/react";
import AssistantPopoverContent from "./assistant-popover-content";
import React, { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "./button";

export default function AssistantPopoverView({
  threadId,
  onClose,
}: {
  threadId?: string;
  onClose?: () => void;
}) {
  return (
    <div className="w-[420px] max-w-[90vw] py-3 px-2">
      <div className="flex items-center justify-between mb-2">
        <strong>Assistant</strong>
        <Button variant="ghost" size="sm" onClick={() => onClose?.()}>
          Close
        </Button>
      </div>

      <p className="text-xs mb-2 text-neutral-400">
        Just send your prompt and the assistant will do it's magic.
      </p>

      {threadId && <AssistantPopoverContent threadId={threadId} />}
    </div>
  );
}
