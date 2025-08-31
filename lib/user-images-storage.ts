// LocalStorage helpers for managing user image metadata.
// Stores a map under the key "user-images": { [url: string]: { uploadedAt: number, fileName?: string } }.
// Backward compatible with older array<string> format by auto-migrating on read.

const KEY = "user-images";

type ImageEntry = { uploadedAt: number; fileName?: string };
export type ImageMap = Record<string, ImageEntry>; // url -> entry

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function coerceMap(value: unknown): ImageMap {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: ImageMap = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (typeof k !== "string") continue;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const n = Number((v as any).uploadedAt);
        if (!Number.isNaN(n) && Number.isFinite(n)) {
          const fn = (v as any).fileName;
          out[k] = {
            uploadedAt: n,
            fileName: typeof fn === "string" ? fn : undefined,
          };
        }
      } else {
        // Legacy: map was number; or unknown
        const n = Number(v);
        if (!Number.isNaN(n) && Number.isFinite(n)) out[k] = { uploadedAt: n };
      }
    }
    return out;
  }
  if (Array.isArray(value)) {
    // Legacy: array of URLs
    const out: ImageMap = {};
    const now = Date.now();
    for (const u of value) {
      if (typeof u === "string" && u) out[u] = { uploadedAt: now };
    }
    return out;
  }
  return {};
}

export function getUserImagesMap(): ImageMap {
  if (!isBrowser()) return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return coerceMap(parsed);
  } catch {
    return {};
  }
}

export function setUserImagesMap(map: ImageMap): void {
  if (!isBrowser()) return;
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function addUserImageKV(
  url: string,
  uploadedAt: number,
  fileName?: string
): ImageMap {
  if (!isBrowser() || !url) return getUserImagesMap();
  const map = getUserImagesMap();
  map[url] = { uploadedAt, fileName: fileName || map[url]?.fileName };
  setUserImagesMap(map);
  return map;
}

export function getUserImageUrls(): string[] {
  const map = getUserImagesMap();
  return Object.keys(map);
}

export function removeUserImage(url: string): ImageMap {
  const map = getUserImagesMap();
  if (url in map) {
    delete map[url];
    setUserImagesMap(map);
  }
  return map;
}

export function clearUserImages(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(KEY);
}
