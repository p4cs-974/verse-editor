"use client";

import React from "react";

type SyncStatus = "local" | "synced";

export function SyncStatusDot({ status }: { status: SyncStatus }) {
  const color = status === "local" ? "#3B82F6" : "#2EE6A6"; // blue | mint
  const label =
    status === "local"
      ? "Local changes pending sync"
      : "Content synced with server";

  return (
    <div
      aria-label={label}
      title={label}
      role="status"
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        backgroundColor: color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

export default SyncStatusDot;
