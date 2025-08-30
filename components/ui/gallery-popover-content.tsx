"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { UploadButton } from "@/lib/uploadthing";

export default function GalleryPopoverContent({
  onClose,
}: {
  onClose?: () => void;
}) {
  return (
    <div className="w-[480px] max-w-[90vw] p-3">
      <div className="flex items-center justify-between mb-2">
        <strong>Gallery</strong>
        <Button variant="ghost" size="sm" onClick={() => onClose?.()}>
          Close
        </Button>
      </div>

      <UploadButton
        endpoint={"imageUploader"}
        onClientUploadComplete={(res) => {
          // Do something with the response
          console.log("Files: ", res);
          alert("Upload Completed");
        }}
        onUploadError={(error: Error) => {
          // Do something with the error.
          alert(`ERROR! ${error.message}`);
        }}
      />
    </div>
  );
}
