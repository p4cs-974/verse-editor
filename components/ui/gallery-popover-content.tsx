"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { UploadButton } from "@/lib/uploadthing";
import { api } from "../../convex/_generated/api";
import { useMutation } from "convex/react";
import { addUserImage as addToLocal } from "@/lib/user-images-storage";

export default function GalleryPopoverContent({
  onClose,
}: {
  onClose?: () => void;
}) {
  const addUserImage = useMutation(api.userImages.addUserImage);

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
        onClientUploadComplete={async (res) => {
          try {
            for (const item of res ?? []) {
              // Debug: inspect UploadThing client payload
              // console.log("upload complete item:", item);
              const url =
                (item as any)?.serverData?.fileUrl ?? (item as any)?.url;
              if (!url) continue;
              const uploadedAt =
                (item as any)?.serverData?.uploadedAt ?? Date.now();
              const contentType = (item as any)?.serverData?.contentType as
                | string
                | undefined;
              const size = (item as any)?.serverData?.size as
                | number
                | undefined;

              // 1) localStorage
              addToLocal(url);

              // 2) Convex DB
              await addUserImage({
                fileUrl: url,
                uploadedAt,
                contentType,
                size,
              });
            }
          } catch (e) {
            console.error(e);
            alert("Failed to record upload");
          }
          alert("Upload Completed");
        }}
        onUploadError={(error: Error) => {
          alert(`ERROR! ${error.message}`);
        }}
      />
    </div>
  );
}
