/**
 * lib/export-settings.ts
 *
 * Provides typed load/save/clear helpers for export settings persisted in localStorage.
 *
 * Format stored as JSON: { pagination: boolean, pageFormat: '4:3'|'A4', updatedAt?: string }
 */

export type ExportSettings = {
  pagination: boolean;
  pageFormat: "4:3" | "A4";
};

const DEFAULT_SETTINGS: ExportSettings = {
  pagination: false,
  pageFormat: "A4",
};

function keyFor(docId?: string) {
  return docId ? `export-settings:${docId}` : `export-settings:global`;
}

type PendingSave = {
  timeoutId?: number | null;
  latestSettings: ExportSettings;
  resolvers: Array<() => void>;
};

const pendingSaves: Map<string, PendingSave> = new Map();
const DEBOUNCE_MS = 200;

export function loadExportSettings(docId?: string): ExportSettings {
  const k = keyFor(docId);
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    // Validate parsed shape minimally
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.pagination === "boolean" &&
      (parsed.pageFormat === "A4" || parsed.pageFormat === "4:3")
    ) {
      return {
        pagination: parsed.pagination,
        pageFormat: parsed.pageFormat,
      } as ExportSettings;
    }
    return DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save export settings with debounce per-key.
 * Returns a Promise that resolves when the actual write to localStorage happened.
 */
export function saveExportSettings(
  settings: ExportSettings,
  docId?: string
): Promise<void> {
  const k = keyFor(docId);

  let pending = pendingSaves.get(k);
  if (!pending) {
    pending = {
      timeoutId: null,
      latestSettings: settings,
      resolvers: [],
    };
    pendingSaves.set(k, pending);
  } else {
    pending.latestSettings = settings;
  }

  const promise = new Promise<void>((resolve) => {
    pending!.resolvers.push(resolve);
  });

  // clear previous timer
  if (pending.timeoutId) {
    window.clearTimeout(pending.timeoutId);
    pending.timeoutId = null;
  }

  pending.timeoutId = window.setTimeout(() => {
    try {
      const toWrite = {
        ...pending!.latestSettings,
        updatedAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem(k, JSON.stringify(toWrite));
      } catch {
        // ignore storage errors
      }
      // dispatch event
      try {
        const ev = new CustomEvent("export-settings:updated", {
          detail: { docId, settings: pending!.latestSettings },
        });
        window.dispatchEvent(ev);
      } catch {
        // ignore dispatch errors
      }
      // resolve all promises
      pending!.resolvers.forEach((r) => {
        try {
          r();
        } catch {}
      });
    } finally {
      pendingSaves.delete(k);
    }
  }, DEBOUNCE_MS) as unknown as number;

  pending.timeoutId = pending.timeoutId;
  return promise;
}

/**
 * Clear stored export settings (used in tests).
 * Also cancels any pending debounced saves.
 */
export function clearExportSettings(docId?: string): void {
  const k = keyFor(docId);
  // cancel pending
  const pending = pendingSaves.get(k);
  if (pending && pending.timeoutId) {
    window.clearTimeout(pending.timeoutId);
  }
  pendingSaves.delete(k);
  try {
    localStorage.removeItem(k);
  } catch {
    // ignore
  }
}
