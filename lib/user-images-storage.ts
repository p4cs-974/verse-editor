// Simple localStorage helpers for managing an array of image URLs under the key "user-images".
// Values are strings (e.g., UploadThing file URLs).

const KEY = "user-images";

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function sanitizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string");
}

export function getUserImages(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return sanitizeArray(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function setUserImages(images: string[]): void {
  if (!isBrowser()) return;
  const arr = sanitizeArray(images);
  localStorage.setItem(KEY, JSON.stringify(arr));
}

export function addUserImage(imageUrl: string): string[] {
  if (typeof imageUrl !== "string" || !imageUrl) return getUserImages();
  const current = getUserImages();
  if (current.includes(imageUrl)) return current;
  const next = [...current, imageUrl];
  setUserImages(next);
  return next;
}

export function removeUserImage(imageUrl: string): string[] {
  const current = getUserImages();
  const next = current.filter((u) => u !== imageUrl);
  setUserImages(next);
  return next;
}

export function clearUserImages(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(KEY);
}
