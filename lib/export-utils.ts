// lib/export-utils.ts
import { marked } from "marked";
import createDOMPurify from "dompurify";

const DOMPurify = (
  typeof window !== "undefined"
    ? createDOMPurify(window)
    : { sanitize: (s: string) => s }
) as any;

type Progress = {
  stage: string;
  current?: number;
  total?: number;
  message?: string;
};

const subscribers: Array<(p: Progress) => void> = [];
export const exportProgress = {
  subscribe(callback: (progress: Progress) => void) {
    subscribers.push(callback);
    return () => {
      const idx = subscribers.indexOf(callback);
      if (idx !== -1) subscribers.splice(idx, 1);
    };
  },
};
function emitProgress(p: Progress) {
  try {
    subscribers.forEach((s) => {
      try {
        s(p);
      } catch (e) {
        console.warn("exportProgress subscriber error", e);
      }
    });
  } catch (e) {}
}

let currentAbort: AbortController | null = null;
export function cancelCurrentExport() {
  if (currentAbort) {
    currentAbort.abort();
  }
}

function sanitizeFilename(name?: string) {
  if (!name) return null;
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 200);
}

export function getPreviewElement(): HTMLElement {
  const el =
    document.querySelector<HTMLElement>("[data-export-preview]") ||
    document.getElementById("verse-preview");
  if (!el)
    throw new Error(
      'Preview element not found. Add an element with [data-export-preview] or id="verse-preview" for export.'
    );
  return el;
}

const BASE_STYLE_PROPS = [
  "font-family",
  "font-size",
  "color",
  "background-color",
  "margin",
  "padding",
  "display",
  "width",
  "height",
  "line-height",
  "text-align",
  "font-weight",
];

// Extra properties that commonly contain colors or gradients.
// We will aggressively sanitize these in the final pass to prevent lab() from leaking to html2canvas.
const SANITIZE_COLOR_PROPS = [
  "color",
  "background",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "text-shadow",
  "box-shadow",
  "fill",
  "stroke",
  "stop-color",
  "caret-color",
  "column-rule-color",
  "accent-color",
];

/**
 * Utilities to convert CSS color() / lab() values into sRGB strings.
 * html2canvas (and other renderers) may choke on modern CSS color functions
 * such as `lab()` when they attempt to parse inline styles. When serializing
 * computed styles we detect `lab(...)` occurrences and convert them to plain
 * `rgb(...)` / `rgba(...)` values.
 *
 * The implementation below implements Lab -> XYZ -> sRGB conversion with
 * D65 white point. It's an approximation suitable for export rendering.
 */
function clamp(n: number, a = 0, b = 1) {
  return Math.min(b, Math.max(a, n));
}

function labToXyz(L: number, a: number, b: number) {
  // L is 0..100
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const fx3 = Math.pow(fx, 3);
  const fy3 = Math.pow(fy, 3);
  const fz3 = Math.pow(fz, 3);

  const epsilon = 0.008856; // (6/29)^3
  const kappa = 903.3;

  const xr = fx3 > epsilon ? fx3 : (116 * fx - 16) / kappa;
  const yr = fy3 > epsilon ? fy3 : (116 * fy - 16) / kappa;
  const zr = fz3 > epsilon ? fz3 : (116 * fz - 16) / kappa;

  // Reference white D65
  const X = xr * 95.047;
  const Y = yr * 100.0;
  const Z = zr * 108.883;

  return { X, Y, Z };
}

function xyzToLinearRgb(X: number, Y: number, Z: number) {
  // Convert XYZ (0..100) to linear RGB (approx)
  X = X / 100;
  Y = Y / 100;
  Z = Z / 100;
  const r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
  const g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
  const b = X * 0.0557 + Y * -0.204 + Z * 1.057;
  return { r, g, b };
}

function linearToSrgbChannel(c: number) {
  // sRGB companding
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function labToSRGB(L: number, a: number, b: number) {
  const { X, Y, Z } = labToXyz(L, a, b);
  const { r: lr, g: lg, b: lb } = xyzToLinearRgb(X, Y, Z);
  const r = clamp(linearToSrgbChannel(lr), 0, 1);
  const g = clamp(linearToSrgbChannel(lg), 0, 1);
  const bch = clamp(linearToSrgbChannel(lb), 0, 1);
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(bch * 255),
  };
}

/**
 * Parse CSS `lab()` function occurrences and convert to `rgb()` / `rgba()`.
 * Handles forms like:
 *   lab(48.4493% 77.4328 61.5452)
 *   lab(100% 0 0 / .1)
 */
function convertLabCssToRgb(value: string): string {
  if (!value || value.indexOf("lab(") === -1) return value;

  // Regex to capture L a b and optional alpha (with optional % on L/alpha)
  // Examples matched: lab(48.44% 77.4 61.54), lab(100% 0 0 / .1), lab(50 10 -20 / 50%)
  // Also handles CSS custom properties: --color: lab(48.44% 77.4 61.54);
  const labRegex =
    /lab\(\s*([0-9.+-]+%?)\s+([0-9.+-]+)\s+([0-9.+-]+)(?:\s*\/\s*([0-9.+-]+%?))?\s*\)/gi;

  return value.replace(labRegex, (_match, Lraw, aRaw, bRaw, alphRaw) => {
    const L = String(Lraw).endsWith("%")
      ? parseFloat(Lraw.replace("%", ""))
      : parseFloat(Lraw);
    const a = parseFloat(aRaw);
    const b = parseFloat(bRaw);
    let alpha = 1;
    if (alphRaw !== undefined) {
      if (String(alphRaw).endsWith("%")) {
        alpha = clamp(parseFloat(String(alphRaw).replace("%", "")) / 100, 0, 1);
      } else {
        alpha = clamp(parseFloat(alphRaw), 0, 1);
      }
    }

    // L in our functions expects 0..100; if the input was a number without % it's treated the same.
    const { r, g, b: bb } = labToSRGB(L, a, b);
    if (alpha < 1) {
      return `rgba(${r}, ${g}, ${bb}, ${Number(alpha.toFixed(3))})`;
    }
    return `rgb(${r}, ${g}, ${bb})`;
  });
}

/**
 * Convert LCH(a,b,h) to RGB by converting to Lab first then to sRGB.
 * Handles CSS syntax like: lch(83.92% -48.71 13.88) or lch(83.92% 48.71 13.88)
 * where the sign/ordering may differ; we expect L C h ordering per spec.
 */
function convertLchCssToRgb(value: string): string {
  if (!value || value.indexOf("lch(") === -1) return value;
  const lchRegex =
    /lch\(\s*([0-9.+-]+%?)\s+([0-9.+-]+)\s+([0-9.+-]+)(?:\s*\/\s*([0-9.+-]+%?))?\s*\)/gi;
  return value.replace(lchRegex, (_m, Lraw, Craw, hRaw, alphRaw) => {
    const L = String(Lraw).endsWith("%")
      ? parseFloat(Lraw.replace("%", ""))
      : parseFloat(Lraw);
    const C = parseFloat(Craw);
    const h = parseFloat(hRaw) * (Math.PI / 180);
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    let alpha = 1;
    if (alphRaw !== undefined) {
      if (String(alphRaw).endsWith("%")) {
        alpha = clamp(parseFloat(String(alphRaw).replace("%", "")) / 100, 0, 1);
      } else {
        alpha = clamp(parseFloat(alphRaw), 0, 1);
      }
    }
    const { r, g, b: bb } = labToSRGB(L, a, b);
    if (alpha < 1)
      return `rgba(${r}, ${g}, ${bb}, ${Number(alpha.toFixed(3))})`;
    return `rgb(${r}, ${g}, ${bb})`;
  });
}

/**
 * Convert oklab() CSS function to sRGB.
 * Uses established oklab -> linear RGB -> sRGB conversion.
 * Accepts values like: oklab(0.9 0.02 -0.01) or oklab(90% 2  -1)
 */
function oklabToSRGBnum(L: number, a: number, b: number) {
  // CSS oklab L may be percentage (0..100%) or a 0..1 number; callers should
  // normalize prior to calling this. We'll assume L is 0..1 here.
  // Convert to LMS
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bch = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  // gamma
  r = clamp(linearToSrgbChannel(r), 0, 1);
  g = clamp(linearToSrgbChannel(g), 0, 1);
  bch = clamp(linearToSrgbChannel(bch), 0, 1);
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(bch * 255),
  };
}

function convertOklabCssToRgb(value: string): string {
  if (!value || value.indexOf("oklab(") === -1) return value;
  const oklabRegex =
    /oklab\(\s*([0-9.+-]+%?)\s+([0-9.+-]+)\s+([0-9.+-]+)(?:\s*\/\s*([0-9.+-]+%?))?\s*\)/gi;
  return value.replace(oklabRegex, (_m, Lraw, aRaw, bRaw, alphRaw) => {
    // Normalize L to 0..1 if percentage; otherwise keep raw number (common in ok* is 0..1).
    const L = String(Lraw).endsWith("%")
      ? clamp(parseFloat(String(Lraw).replace("%", "")) / 100, 0, 1)
      : parseFloat(Lraw);
    const a = parseFloat(aRaw);
    const b = parseFloat(bRaw);
    let alpha = 1;
    if (alphRaw !== undefined) {
      if (String(alphRaw).endsWith("%")) {
        alpha = clamp(parseFloat(String(alphRaw).replace("%", "")) / 100, 0, 1);
      } else {
        alpha = clamp(parseFloat(alphRaw), 0, 1);
      }
    }
    const { r, g, b: bb } = oklabToSRGBnum(L, a, b);
    if (alpha < 1)
      return `rgba(${r}, ${g}, ${bb}, ${Number(alpha.toFixed(3))})`;
    return `rgb(${r}, ${g}, ${bb})`;
  });
}

/**
 * Convert oklch(...) by translating to oklab then converting.
 */
function convertOklchCssToRgb(value: string): string {
  if (!value || value.indexOf("oklch(") === -1) return value;
  const oklchRegex =
    /oklch\(\s*([0-9.+-]+%?)\s+([0-9.+-]+)\s+([0-9.+-]+)(?:\s*\/\s*([0-9.+-]+%?))?\s*\)/gi;
  return value.replace(oklchRegex, (_m, Lraw, Craw, hRaw, alphRaw) => {
    const L = String(Lraw).endsWith("%")
      ? clamp(parseFloat(String(Lraw).replace("%", "")) / 100, 0, 1)
      : parseFloat(Lraw);
    const C = parseFloat(Craw);
    const h = parseFloat(hRaw) * (Math.PI / 180);
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    let alpha = 1;
    if (alphRaw !== undefined) {
      if (String(alphRaw).endsWith("%")) {
        alpha = clamp(parseFloat(String(alphRaw).replace("%", "")) / 100, 0, 1);
      } else {
        alpha = clamp(parseFloat(alphRaw), 0, 1);
      }
    }
    const { r, g, b: bb } = oklabToSRGBnum(L, a, b);
    if (alpha < 1)
      return `rgba(${r}, ${g}, ${bb}, ${Number(alpha.toFixed(3))})`;
    return `rgb(${r}, ${g}, ${bb})`;
  });
}

/**
 * Central sanitizer: run a set of converters for known CSS color functions.
 */
function sanitizeCssFunctions(html: string): string {
  if (!html) return html;
  try {
    let out = html;

    // Apply all color function conversions in sequence
    out = convertLabCssToRgb(out);
    out = convertLchCssToRgb(out);
    out = convertOklabCssToRgb(out);
    out = convertOklchCssToRgb(out);

    // Also handle color() function which might contain lab values
    out = out.replace(/color\([^)]*\blab\b[^)]*\)/gi, (match) => {
      // Handle color(display-p3 ...) and other color() functions
      // For now, we'll let these pass through as they're more complex
      return match;
    });

    if (out !== html) {
      console.debug(
        "export-utils: sanitized CSS functions in HTML prior to PDF export"
      );
    }
    return out;
  } catch (e) {
    console.warn("export-utils: failed to sanitize CSS functions", e);
    return html;
  }
}

/**
 * Deep scan a Document and sanitize any remaining lab()/lch()/oklab()/oklch() occurrences
 * across style tags, inline style attributes, and a focused set of computed style properties.
 * Returns the number of occurrences fixed (best-effort count).
 */
function scanAndFixLabColorsInDoc(doc: Document): number {
  let fixed = 0;

  // 1) Sanitize all <style> tags (CSSOM will reflect these updates)
  const styleTags = Array.from(doc.querySelectorAll("style"));
  for (const s of styleTags) {
    const before = s.textContent || "";
    const after = sanitizeCssFunctions(before);
    if (after !== before) {
      s.textContent = after;
      fixed++;
    }
  }

  // 2) Remove any <link rel="stylesheet"> to avoid bringing back unsanitized CSS
  // (We shouldn't have any, but if present we remove them)
  const linkSheets = Array.from(
    doc.querySelectorAll('link[rel="stylesheet"]')
  ) as HTMLLinkElement[];
  for (const l of linkSheets) {
    l.parentElement?.removeChild(l);
  }

  // 3) Sanitize inline style attributes
  const allEls = Array.from(doc.querySelectorAll("*")) as HTMLElement[];
  for (const el of allEls) {
    const styleAttr = el.getAttribute("style") || "";
    if (styleAttr && /\b(?:oklch|oklab|lch|lab)\s*\(/i.test(styleAttr)) {
      const sanitized = aggressiveSanitizeColorFunctions(
        sanitizeCssFunctions(styleAttr)
      );
      if (sanitized !== styleAttr) {
        el.setAttribute("style", sanitized);
        fixed++;
      }
    }
  }

  // 3b) Sanitize color-bearing element attributes (SVG/HTML)
  const COLOR_ATTRS = [
    "fill",
    "stroke",
    "stop-color",
    "flood-color",
    "lighting-color",
    "color",
    "bgcolor",
    "outline-color",
    "text-decoration-color",
    "border-color",
  ];
  for (const el of allEls) {
    for (const attrName of COLOR_ATTRS) {
      const attrVal = el.getAttribute(attrName);
      if (attrVal && /\b(?:oklch|oklab|lch|lab)\s*\(/i.test(attrVal)) {
        const sanitized = aggressiveSanitizeColorFunctions(
          sanitizeCssFunctions(attrVal)
        );
        if (sanitized !== attrVal) {
          el.setAttribute(attrName, sanitized);
          fixed++;
        }
      }
    }
  }

  // 4) For a focused set of properties that often contain colors/gradients,
  // check computed style, and if they contain modern color functions, force an inline sanitized value.
  const view = doc.defaultView || window;
  for (const el of allEls) {
    try {
      const cs = view.getComputedStyle(el);
      const toSet: Array<[string, string]> = [];
      for (const prop of SANITIZE_COLOR_PROPS) {
        const val = cs.getPropertyValue(prop);
        if (val && /\b(?:oklch|oklab|lch|lab)\s*\(/i.test(val)) {
          const sanitized = aggressiveSanitizeColorFunctions(
            sanitizeCssFunctions(val)
          );
          if (sanitized !== val) {
            toSet.push([prop, sanitized]);
            fixed++;
          }
        }
      }
      if (toSet.length) {
        const existing = el.getAttribute("style") || "";
        const merged =
          existing +
          (existing && !existing.trim().endsWith(";") ? ";" : "") +
          toSet.map(([p, v]) => `${p}:${v}`).join(";");
        el.setAttribute("style", merged);
      }
    } catch {
      // Ignore any getComputedStyle issues (e.g., detached nodes)
    }
  }

  return fixed;
}

export async function serializePreviewToHTML(
  previewElement: HTMLElement,
  inlineStyles: boolean
): Promise<string> {
  const clone = previewElement.cloneNode(true) as HTMLElement;
  // remove script tags
  clone.querySelectorAll("script").forEach((s) => s.remove());
  // remove event attributes like onclick
  clone.querySelectorAll("*").forEach((el: Element) => {
    for (const attr of Array.from((el as Element).attributes || [])) {
      if (/^on/i.test(attr.name)) (el as Element).removeAttribute(attr.name);
    }
  });
  // inline computed styles if requested
  if (inlineStyles) {
    const walker = document.createTreeWalker(
      clone,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    let node: Node | null = walker.currentNode;
    while (node) {
      if (node.nodeType === 1) {
        const el = node as HTMLElement;
        try {
          const cs = window.getComputedStyle(el);
          const styles: string[] = [];

          // Process standard CSS properties
          BASE_STYLE_PROPS.forEach((prop) => {
            const rawVal = cs.getPropertyValue(prop);
            if (
              rawVal &&
              rawVal !== "initial" &&
              rawVal !== "inherit" &&
              rawVal !== "unset"
            ) {
              let val = rawVal;
              try {
                // Apply all color function conversions
                val = convertLabCssToRgb(val);
                val = convertLchCssToRgb(val);
                val = convertOklabCssToRgb(val);
                val = convertOklchCssToRgb(val);

                if (val !== rawVal) {
                  console.debug(
                    "export-utils: converted CSS color for export",
                    {
                      property: prop,
                      original: rawVal,
                      converted: val,
                    }
                  );
                }
              } catch (e) {
                // on any parse error, fall back to the original value
              }
              styles.push(`${prop}:${val}`);
            }
          });

          // Also process any inline style attributes that might contain lab() functions
          const existingStyle = el.getAttribute("style") || "";
          if (existingStyle) {
            try {
              const sanitizedStyle = sanitizeCssFunctions(existingStyle);
              if (sanitizedStyle !== existingStyle) {
                styles.unshift(sanitizedStyle); // Add at beginning to override
              } else {
                styles.unshift(existingStyle);
              }
            } catch (e) {
              styles.unshift(existingStyle);
            }
          }

          if (styles.length) {
            el.setAttribute("style", styles.join(";"));
          }
        } catch (e) {
          // ignore cross-origin computed style errors
        }
      }
      node = walker.nextNode();
    }
  }
  // collect style tags and link tags from document
  const headParts: string[] = [];
  document.querySelectorAll("style").forEach((s) => {
    const sanitized = sanitizeCssFunctions(s.outerHTML);
    headParts.push(sanitized);
  });
  document
    .querySelectorAll("link[rel=stylesheet]")
    .forEach((l) => headParts.push(l.outerHTML));
  const headHtml = headParts.join("\n");
  const bodyHtml = clone.innerHTML;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${headHtml}
</head>
<body>${bodyHtml}</body>
</html>`;
  return html;
}

async function fetchAsDataUrl(
  url: string,
  signal?: AbortSignal
): Promise<{ dataUrl?: string; warning?: string }> {
  try {
    const res = await fetch(url, { mode: "cors", signal });
    if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
    const contentLength = Number(res.headers.get("content-length") || "0");
    if (contentLength && contentLength > 5 * 1024 * 1024) {
      const msg = `Skipping inlining ${url} because it exceeds 5MB`;
      console.warn(msg);
      emitProgress({ stage: "warning", message: msg });
      return { warning: msg };
    }
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return { dataUrl: data };
  } catch (e: any) {
    const msg = `Failed to inline ${url}: ${e?.message || e}`;
    console.warn(msg);
    emitProgress({ stage: "warning", message: msg });
    return { warning: msg };
  }
}

export async function inlineExternalAssets(html: string): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const imgs = Array.from(
    doc.querySelectorAll("img[src]")
  ) as HTMLImageElement[];
  currentAbort = currentAbort || new AbortController();
  const signal = currentAbort.signal;
  for (const img of imgs) {
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) continue;
    if (signal.aborted) throw new Error("Export aborted");
    const { dataUrl, warning } = await fetchAsDataUrl(src, signal);
    if (dataUrl) {
      img.setAttribute("src", dataUrl);
    } else {
      // replace with placeholder SVG data URL
      const placeholder = `data:image/svg+xml;base64,${btoa(
        `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='200'><rect width='100%' height='100%' fill='#eee'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#666' font-size='16'>Image unavailable</text></svg>`
      )}`;
      img.setAttribute("src", placeholder);
      if (warning) console.warn(warning);
    }
  }
  // TODO: inline fonts (basic heuristic)
  // Search style tags for url(...) patterns and try to inline fonts
  const styleTags = Array.from(doc.querySelectorAll("style"));
  for (const s of styleTags) {
    const text = s.textContent || "";
    const urls = Array.from(
      text.matchAll(/url\((['"]?)(https?:\/\/[^'")]+)\1\)/g)
    );
    for (const m of urls) {
      const url = m[2];
      if (signal.aborted) throw new Error("Export aborted");
      const { dataUrl } = await fetchAsDataUrl(url, signal);
      if (dataUrl) {
        s.textContent = (s.textContent || "").replace(url, dataUrl);
      }
    }
  }
  return doc.documentElement.outerHTML;
}

export function splitHtmlByPagination(
  html: string,
  markdownSource?: string,
  paginationOnHr: boolean = true
): string[] {
  if (markdownSource) {
    const parts = markdownSource.split(/^\s*---\s*$/m);
    return parts.map((chunk) => {
      const rendered = marked.parse(chunk);
      const safe = DOMPurify.sanitize(rendered);
      const headParts: string[] = [];
      document
        .querySelectorAll("style")
        .forEach((s) => headParts.push(s.outerHTML));
      document
        .querySelectorAll("link[rel=stylesheet]")
        .forEach((l) => headParts.push(l.outerHTML));
      const headHtml = headParts.join("\n");
      return `<!doctype html><html lang="en"><head><meta charset="utf-8">${headHtml}</head><body>${safe}</body></html>`;
    });
  }
  if (paginationOnHr) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const body = doc.body;
    const pages: string[] = [];
    let acc: Node[] = [];
    function flush() {
      if (!acc.length) return;
      const wrapper = doc.createElement("div");
      acc.forEach((n) => wrapper.appendChild(n.cloneNode(true)));
      const headParts: string[] = [];
      document
        .querySelectorAll("style")
        .forEach((s) => headParts.push(s.outerHTML));
      document
        .querySelectorAll("link[rel=stylesheet]")
        .forEach((l) => headParts.push(l.outerHTML));
      const headHtml = headParts.join("\n");
      pages.push(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">${headHtml}</head><body>${wrapper.innerHTML}</body></html>`
      );
      acc = [];
    }
    body.childNodes.forEach((node) => {
      if (node.nodeType === 1 && (node as Element).tagName === "HR") {
        flush();
      } else {
        acc.push(node);
      }
    });
    flush();
    return pages.length ? pages : [html];
  }
  return [html];
}

async function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

export async function exportToMarkdown(
  markdownContent: string,
  fileName?: string
): Promise<void> {
  const baseName =
    sanitizeFilename(fileName) ||
    `preview-export-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  const blob = new Blob([markdownContent], {
    type: "text/markdown;charset=utf-8",
  });
  await triggerDownload(blob, baseName);
}

export async function exportToHtmlStandalone(
  htmlDocumentString: string,
  fileName?: string
): Promise<void> {
  // Remove scripts conservatively
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlDocumentString, "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  const cleaned = doc.documentElement.outerHTML;
  const inlined = await inlineExternalAssets(cleaned);
  const baseName =
    sanitizeFilename(fileName) ||
    `preview-export-${new Date().toISOString().replace(/[:.]/g, "-")}.html`;
  const blob = new Blob([inlined], { type: "text/html;charset=utf-8" });
  await triggerDownload(blob, baseName);
}

function mmToPx(mm: number) {
  const dpi = 96; // CSS reference DPI
  return (mm * dpi) / 25.4;
}

export async function exportToPdf(
  htmlDocumentString: string,
  options: { pagination: boolean; pageFormat: "4:3" | "A4"; fileName?: string }
): Promise<void> {
  // Use jsPDF.html for programmatic PDF generation (mixed vector/raster).
  // This keeps the flow fully programmatic and avoids adding new dependencies.
  let JsPDF: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    JsPDF = (await import("jspdf")).jsPDF;
  } catch (e) {
    throw new Error("Please install jspdf to use PDF export: npm i jspdf");
  }

  currentAbort = new AbortController();
  const signal = currentAbort.signal;
  emitProgress({ stage: "start" });

  const pageSizeMm =
    options.pageFormat === "A4" ? { w: 210, h: 297 } : { w: 210, h: 157.5 };
  const pageWidthPx = Math.round(mmToPx(pageSizeMm.w));
  const scale = Math.max(1, Math.min(2, (window.devicePixelRatio || 1) * 1.5));

  const pagesByHr = options.pagination
    ? splitHtmlByPagination(htmlDocumentString, undefined, true)
    : [htmlDocumentString];

  const pdf = new JsPDF({ unit: "mm", format: [pageSizeMm.w, pageSizeMm.h] });

  emitProgress({ stage: "rendering", current: 0, total: pagesByHr.length });

  const parser = new DOMParser();

  for (let pIndex = 0; pIndex < pagesByHr.length; pIndex++) {
    if (signal.aborted) throw new Error("Export aborted");
    const pageHtml = pagesByHr[pIndex];

    const parsed = parser.parseFromString(pageHtml, "text/html");
    const bodyHtml = parsed.body
      ? parsed.body.innerHTML
      : parsed.documentElement.innerHTML;

    // Build sanitized HTML with all styles inlined and lab() functions converted
    const headParts: string[] = [];

    // Create a comprehensive style block that includes all CSS with lab() functions converted
    let combinedCss = "";

    // Process all <style> tags from the parsed page HTML (not global document)
    parsed.querySelectorAll("style").forEach((s) => {
      const text = s.textContent || "";
      // Sanitize and strip @import to prevent remote CSS with lab() from leaking into iframe
      const sanitized = sanitizeCssFunctions(text).replace(
        /@import[^;]+;/g,
        ""
      );
      combinedCss += sanitized + "\n";
    });

    // Try to fetch linked stylesheets and inline their sanitized contents.
    // IMPORTANT: Work off the parsed page HTML to avoid pulling globals.
    const linkElems = Array.from(
      parsed.querySelectorAll("link[rel=stylesheet]")
    ) as HTMLLinkElement[];

    for (const l of linkElems) {
      const href = l.getAttribute("href");
      if (!href) {
        // Missing href — skip including this stylesheet to prevent reintroducing lab() into the iframe.
        const msg =
          "Skipping a stylesheet link without href in PDF export; styling may be degraded.";
        console.warn(msg);
        emitProgress({ stage: "warning", message: msg });
        continue;
      }
      try {
        // Attempt to fetch the stylesheet text (best-effort; may fail due to CORS).
        const res = await fetch(href, {
          mode: "cors",
          signal: currentAbort?.signal,
        });
        if (res && res.ok) {
          const cssText = await res.text();
          combinedCss += sanitizeCssFunctions(cssText) + "\n";
          continue;
        } else {
          const msg = `Skipping external stylesheet due to non-OK response (${res?.status}) from ${href}; styling may be degraded.`;
          console.warn(msg);
          emitProgress({ stage: "warning", message: msg });
        }
      } catch (e: any) {
        // Skip including the original link to avoid loading unsanitized CSS into the iframe
        const msg = `Skipping external stylesheet due to fetch/CORS error from ${href}: ${
          e?.message || e
        }`;
        console.warn(msg);
        emitProgress({ stage: "warning", message: msg });
      }
      // DO NOT push the original link element; this prevents bringing lab() back into the iframe.
    }

    // Add the combined, sanitized CSS as a single style block
    if (combinedCss.trim()) {
      headParts.unshift(`<style>${combinedCss}</style>`);
    }

    const headHtml = headParts.join("\n");
    const printable = `<!doctype html><html><head><meta charset="utf-8">${headHtml}</head><body>${bodyHtml}</body></html>`;
    const inlined = await inlineExternalAssets(printable);
    // Final sanitization pass
    let sanitizedInlined = sanitizeCssFunctions(inlined);
    // Aggressive fallback if any modern color functions remain in the HTML
    if (/\b(?:oklch|oklab|lch|lab)\s*\(/i.test(sanitizedInlined)) {
      sanitizedInlined = aggressiveSanitizeColorFunctions(sanitizedInlined);
    }

    // Create an isolated iframe to render the sanitized content
    // This prevents html2canvas from reading lab() functions from the main document's stylesheets
    const iframe = document.createElement("iframe");
    iframe.style.position = "absolute";
    iframe.style.left = "-99999px";
    iframe.style.top = "0";
    iframe.style.width = pageWidthPx + "px";
    iframe.style.height = "1000px"; // Give it some height
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    // Wait for iframe to be ready
    await new Promise<void>((resolve) => {
      const onLoad = () => {
        iframe.removeEventListener("load", onLoad);
        resolve();
      };
      iframe.addEventListener("load", onLoad);
      // Set empty src to initialize the iframe
      iframe.src = "about:blank";
    });

    // Write our sanitized HTML to the iframe
    if (iframe.contentDocument) {
      iframe.contentDocument.open();
      iframe.contentDocument.write(sanitizedInlined);
      iframe.contentDocument.close();

      // Wait for layout and fonts in the iframe
      await new Promise((r) => setTimeout(r, 100));
      try {
        await (iframe.contentDocument as any).fonts?.ready;
      } catch {}

      // Pre-render deep sanitization inside the iframe document to ensure no lab() remains
      try {
        const preFixed = scanAndFixLabColorsInDoc(iframe.contentDocument!);
        if (preFixed > 0) {
          console.debug(
            "export-utils: iframe pre-render sanitized modern color functions",
            { fixed: preFixed }
          );
        }
      } catch (e) {
        console.warn("export-utils: iframe pre-render sanitize failed", e);
      }

      await new Promise<void>((resolve, reject) => {
        try {
          if (pIndex > 0) {
            pdf.addPage();
          }

          emitProgress({
            stage: "rendering-page",
            current: pIndex + 1,
            total: pagesByHr.length,
            message: `Rendering page ${pIndex + 1} of ${pagesByHr.length}`,
          });

          // Render the iframe's body content
          (pdf as any).html(iframe.contentDocument!.body, {
            x: 0,
            y: 0,
            html2canvas: {
              scale,
              useCORS: true,
              allowTaint: true,
              // Final safety net: sanitize colors in the cloned DOM just before html2canvas renders it.
              onclone: (clonedDoc: Document) => {
                try {
                  const fixed = scanAndFixLabColorsInDoc(clonedDoc);
                  if (fixed > 0) {
                    console.debug(
                      "export-utils: onclone sanitized modern color functions",
                      { fixed }
                    );
                  }
                } catch (e) {
                  console.warn("export-utils: onclone sanitize failed", e);
                }
              },
            },
            width: pageSizeMm.w,
            autoPaging: "text",
            callback: function () {
              resolve();
            },
          });
        } catch (err) {
          reject(err);
        }
      });
    } else {
      throw new Error("Failed to create iframe document for PDF rendering");
    }

    // Clean up iframe
    try {
      document.body.removeChild(iframe);
    } catch {}
  }

  const filename =
    sanitizeFilename(options.fileName) ||
    `preview-export-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
  try {
    pdf.save(filename);
    emitProgress({ stage: "done" });
  } finally {
    currentAbort = null;
  }
}

export async function exportPreview(
  format: "pdf" | "html" | "markdown",
  settings: {
    pagination: boolean;
    pageFormat: "4:3" | "A4";
    fileName?: string;
    docId?: string;
    markdownContent?: string;
  }
): Promise<void> {
  const el = getPreviewElement();
  if (format === "markdown") {
    const md = settings.markdownContent || "";
    return exportToMarkdown(md, settings.fileName);
  }
  const html = await serializePreviewToHTML(el, true);
  if (format === "html") {
    return exportToHtmlStandalone(html, settings.fileName);
  }
  if (format === "pdf") {
    return exportToPdf(html, {
      pagination: settings.pagination,
      pageFormat: settings.pageFormat,
      fileName: settings.fileName,
    });
  }
  return Promise.reject(new Error("Unknown format"));
}

/**
 * Aggressive fallback sanitizer: if any modern color function remains (lab/lch/oklab/oklch)
 * that our precise converters couldn't handle (e.g., due to var()/calc() usage),
 * replace it with a safe sRGB fallback so html2canvas won't crash.
 * Attempts to preserve alpha when present.
 */
function aggressiveSanitizeColorFunctions(input: string): string {
  if (!input) return input;
  try {
    let out = input;
    out = out.replace(/\b(oklch|oklab|lch|lab)\([^)]*\)/gi, (m) => {
      const alphaMatch = m.match(/\/\s*([0-9.]+%?)/);
      if (alphaMatch) {
        let a = alphaMatch[1];
        let alpha = 1;
        if (/%$/.test(a)) {
          alpha = clamp(parseFloat(a) / 100, 0, 1);
        } else {
          alpha = clamp(parseFloat(a), 0, 1);
        }
        return `rgba(0, 0, 0, ${Number((alpha || 0).toFixed(3))})`;
      }
      return "rgb(0, 0, 0)";
    });
    return out;
  } catch {
    return input;
  }
}
