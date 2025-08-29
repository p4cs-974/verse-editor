"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import ToolbarButton from "./toolbar-button";
import { Settings } from "lucide-react";
import {
  ExportSettings,
  loadExportSettings,
  saveExportSettings,
} from "../../lib/export-settings";

interface ExportSettingsButtonProps {
  docId?: string;
  className?: string;
  onChange?: (settings: ExportSettings) => void;
}

export default function ExportSettingsButton({
  docId,
  className,
  onChange,
}: ExportSettingsButtonProps) {
  const id = useId();
  const popoverId = `export-settings-${id}`;

  const key = docId ? `export-settings:${docId}` : `export-settings:global`;

  const [open, setOpen] = useState(false);

  const [settings, setSettings] = useState<ExportSettings>({
    pagination: false,
    pageFormat: "A4",
  });

  const [saved, setSaved] = useState(false);
  const hideSavedTimeout = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (hideSavedTimeout.current) {
        window.clearTimeout(hideSavedTimeout.current);
        hideSavedTimeout.current = null;
      }
    };
  }, []);

  // Initialize from persisted settings on mount or when docId changes
  useEffect(() => {
    try {
      const loaded = loadExportSettings(docId);
      setSettings(loaded);
      if (onChange) onChange(loaded);
    } catch {
      // ignore
    }
    // listen for cross-window updates (optional)
    const handler = (e: Event) => {
      try {
        const ce = e as CustomEvent;
        const detail = ce.detail as {
          docId?: string;
          settings: ExportSettings;
        };
        // Only react if the event is for the same docId scope
        const matches =
          (detail.docId && detail.docId === docId) ||
          (!detail.docId && !docId) ||
          (!detail.docId && docId === undefined);
        if (matches && detail?.settings) {
          setSettings(detail.settings);
          if (onChange) onChange(detail.settings);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener(
      "export-settings:updated",
      handler as EventListener
    );
    return () =>
      window.removeEventListener(
        "export-settings:updated",
        handler as EventListener
      );
  }, [docId, onChange]);

  // Save when settings change. saveExportSettings is debounced internally.
  useEffect(() => {
    let cancelled = false;
    // call onChange immediately to notify parent of change (some callers expect immediate)
    if (onChange) {
      try {
        onChange(settings);
      } catch {}
    }

    const p = saveExportSettings(settings, docId);
    p.then(() => {
      if (cancelled || !mountedRef.current) return;
      setSaved(true);
      if (hideSavedTimeout.current) {
        window.clearTimeout(hideSavedTimeout.current);
      }
      hideSavedTimeout.current = window.setTimeout(() => {
        setSaved(false);
        hideSavedTimeout.current = null;
      }, 1200) as unknown as number;
    }).catch(() => {
      // ignore errors for now
    });

    return () => {
      cancelled = true;
    };
  }, [settings, docId, onChange]);

  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // simple focus sentinels
  const firstControlRef = useRef<HTMLButtonElement | null>(null);
  const lastControlRef = useRef<HTMLButtonElement | null>(null);

  function onKeyDownMenu(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
      >
        <ToolbarButton
          ref={buttonRef}
          icon={Settings}
          label="Export settings"
          ariaLabel="Export settings"
          className={className}
        />
      </PopoverTrigger>

      <PopoverContent
        id={popoverId}
        role="dialog"
        aria-modal="true"
        sideOffset={8}
        align="center"
        onKeyDown={onKeyDownMenu}
      >
        <div className="w-64">
          <div className="flex items-center justify-between mb-2">
            <strong>Export settings</strong>
            <span className="text-sm text-green-600">
              {saved ? "Saved" : ""}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-between gap-2">
              <span>Pagination</span>
              <input
                ref={firstControlRef as any}
                type="checkbox"
                checked={settings.pagination}
                onChange={(e) => {
                  const next: ExportSettings = {
                    ...settings,
                    pagination: e.target.checked,
                  };
                  setSettings(next);
                }}
              />
            </label>

            <fieldset>
              <legend className="text-sm mb-1">Page format</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`pageFormat-${id}`}
                  value="A4"
                  checked={settings.pageFormat === "A4"}
                  onChange={() => {
                    const next: ExportSettings = {
                      ...settings,
                      pageFormat: "A4",
                    };
                    setSettings(next);
                  }}
                />
                <span>A4</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`pageFormat-${id}`}
                  value="4:3"
                  checked={settings.pageFormat === "4:3"}
                  onChange={() => {
                    const next: ExportSettings = {
                      ...settings,
                      pageFormat: "4:3",
                    };
                    setSettings(next);
                  }}
                />
                <span>4:3</span>
              </label>
            </fieldset>

            <div className="flex justify-end mt-2">
              <button
                ref={lastControlRef as any}
                className="text-sm text-gray-600"
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
