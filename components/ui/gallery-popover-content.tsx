"use client";

import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { UploadButton } from "@/lib/uploadthing";
import { api } from "../../convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  addUserImageKV,
  getUserImageUrls,
  getUserImagesMap,
  setUserImagesMap,
} from "@/lib/user-images-storage";
import UserGallery from "./user-gallery";

function baseNameNoExtFromUrl(url: string): string | undefined {
  try {
    const u = new URL(
      url,
      typeof window !== "undefined" ? window.location.href : "http://localhost"
    );
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (!last) return undefined;
    const i = last.lastIndexOf(".");
    return i > 0
      ? decodeURIComponent(last.slice(0, i))
      : decodeURIComponent(last);
  } catch {
    const path = url.split("?")[0].split("#")[0];
    const last = path.split("/").filter(Boolean).pop();
    if (!last) return undefined;
    const i = last.lastIndexOf(".");
    return i > 0 ? last.slice(0, i) : last;
  }
}

export default function GalleryPopoverContent({
  onClose,
}: {
  onClose?: () => void;
}) {
  const addUserImage = useMutation(api.userImages.addUserImage);
  const imagesFromServer = useQuery(api.userImages.listForOwner, {});

  // Merge server data into local storage and prune entries not present on server
  useEffect(() => {
    if (!imagesFromServer) return; // still loading or not authed
    const current = getUserImagesMap();
    const serverSet = new Set(imagesFromServer.map((i) => i.fileUrl));
    let changed = false;

    // Prune locals missing on server
    for (const url of Object.keys(current)) {
      if (!serverSet.has(url)) {
        delete current[url];
        changed = true;
      }
    }

    // Merge/refresh from server
    for (const img of imagesFromServer) {
      const existing = current[img.fileUrl];
      if (
        !existing ||
        existing.uploadedAt !== img.uploadedAt ||
        (!existing.fileName && img.fileName)
      ) {
        current[img.fileUrl] = {
          uploadedAt: img.uploadedAt,
          fileName: img.fileName,
        };
        changed = true;
      }
    }

    if (changed) setUserImagesMap(current);
  }, [imagesFromServer]);

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
              const fileName =
                (item as any)?.serverData?.fileName ??
                baseNameNoExtFromUrl(url);
              const fileKey = (item as any)?.serverData?.fileKey as
                | string
                | undefined;

              // 1) localStorage KV (no fileKey persistence client-side for now)
              addUserImageKV(url, uploadedAt, fileName);

              // 2) Convex DB
              await addUserImage({
                fileUrl: url,
                fileKey: fileKey ?? "",
                fileName,
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

      <hr className="my-4" />

      <UserGallery urls={getUserImageUrls()} />
    </div>
  );
}
