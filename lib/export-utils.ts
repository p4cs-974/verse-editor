// lib/export-utils.ts
import { marked } from "marked";
import createDOMPurify from "dompurify";
import html2canvasPro from "html2canvas-pro";

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

  const epsilon = 0.008856; // (6/29)ˆ3
  const kappa = 903.3; // (29/3)^3

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
  html: string,
  opts: {
    pagination: boolean;
    pageFormat: "4:3" | "A4";
    fileName?: string;
  }
): Promise<void> {
  // High-level steps:
  // 1. Inline external assets (images/fonts) so PDF is self-contained.
  // 2. Sanitize/convert modern color functions that break renderers.
  // 3. Split into pages if pagination requested.
  // 4. For each page, render to canvas via html2canvas and add to PDF via jsPDF.
  // 5. Emit progress events and support abort via currentAbort.
  currentAbort = currentAbort || new AbortController();
  const signal = currentAbort.signal;
  try {
    emitProgress({ stage: "start", message: "Starting PDF export" });

    // 1) Inline assets
    emitProgress({ stage: "inlining", message: "Inlining external assets" });
    if (signal.aborted) throw new Error("Export aborted");
    let inlined = await inlineExternalAssets(html);

    if (signal.aborted) throw new Error("Export aborted");

    // 2) Sanitize modern color functions in style blocks / inline styles
    emitProgress({
      stage: "sanitizing",
      message: "Sanitizing color functions and styles",
    });
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(inlined, "text/html");
      // Run the document fixer which modifies style tags / inline styles
      const fixed = scanAndFixLabColorsInDoc(doc);
      if (fixed) {
        inlined = doc.documentElement.outerHTML;
      } else {
        // Still run a last-pass aggressive sanitizer on the raw HTML string
        inlined = sanitizeCssFunctions(inlined);
        inlined = aggressiveSanitizeColorFunctions(inlined);
      }
    } catch (e) {
      // Continue even if sanitizer fails; we'll try aggressive fallback later
      console.warn("export-utils: color sanitization failed", e);
      inlined = aggressiveSanitizeColorFunctions(inlined);
    }

    if (signal.aborted) throw new Error("Export aborted");

    // 3) Pagination - split into logical pages
    emitProgress({
      stage: "paginate",
      message: "Splitting content into pages",
    });
    const pages = splitHtmlByPagination(inlined, undefined, opts.pagination);

    // Precompute page dimensions in mm
    const pageWidthMm = opts.pageFormat === "A4" ? 210 : 210; // use 210mm width
    const pageHeightMm = opts.pageFormat === "A4" ? 297 : 210 * (3 / 4); // A4 or 4:3 (width x 3/4)

    // Load rendering libraries dynamically so bundlers can tree-shake them and tests can mock
    emitProgress({
      stage: "load-libs",
      message: "Loading rendering libraries",
    });
    if (signal.aborted) throw new Error("Export aborted");
    // Prefer the statically imported `html2canvas-pro` (faster startup). If for any reason it is not
    // present at runtime, fall back to dynamic import of the OSS `html2canvas`.
    let html2canvasLib: any;
    try {
      if (typeof html2canvasPro !== "undefined" && html2canvasPro) {
        // html2canvas-pro may export the function as default or directly.
        html2canvasLib =
          (html2canvasPro as any).default || (html2canvasPro as any);
        emitProgress({
          stage: "lib",
          message: "Using html2canvas-pro (static import)",
        });
      } else {
        html2canvasLib = (await import("html2canvas")).default as any;
        emitProgress({
          stage: "lib",
          message: "Using html2canvas (dynamic import)",
        });
      }
    } catch (e) {
      // Last-resort fallback: try dynamic import of html2canvas
      try {
        html2canvasLib = (await import("html2canvas")).default as any;
        emitProgress({
          stage: "lib",
          message: "Falling back to html2canvas (dynamic import)",
        });
      } catch {
        throw new Error("html2canvas-pro/html2canvas not available");
      }
    }
    const { jsPDF } = await import("jspdf");
    if (!html2canvasLib || !jsPDF) {
      throw new Error("Required PDF rendering libraries not available");
    }

    // Prepare PDF
    const fileName =
      sanitizeFilename(opts.fileName) ||
      `preview-export-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;

    // Create a PDF instance. We'll use mm units to make sizing easier.
    const pdf = new jsPDF({
      unit: "mm",
      format:
        opts.pageFormat === "A4"
          ? "a4"
          : [
              Math.round(pageWidthMm * 10) / 10,
              Math.round(pageHeightMm * 10) / 10,
            ],
    }) as any;

    // Render each page in sequence
    for (let i = 0; i < pages.length; i++) {
      if (signal.aborted) throw new Error("Export aborted");
      emitProgress({
        stage: "render",
        current: i + 1,
        total: pages.length,
        message: `Rendering page ${i + 1} of ${pages.length}`,
      });

      // Create an offscreen iframe to render the page HTML in an isolated document
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.left = "-9999px";
      iframe.style.top = "-9999px";
      iframe.style.width = `${Math.round(mmToPx(pageWidthMm))}px`;
      // Initially set a minimal height; we'll resize to fit content after load
      iframe.style.height = `200px`;
      // Allow scripts so the iframe can run font-loading / CSSOM related tasks.
      // This is reasonably safe because exported HTML is produced by
      // `serializePreviewToHTML()` which removes <script> tags and event attributes.
      iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
      document.body.appendChild(iframe);

      try {
        const idoc = iframe.contentDocument;
        if (!idoc)
          throw new Error("Failed to create iframe document for rendering");
        idoc.open();
        idoc.write(pages[i]);
        idoc.close();

        // Wait for fonts/images to load with a bounded timeout so we don't hang.
        {
          const timeoutMs = 5000;
          const fontsReadyPromise =
            (idoc as any).fonts && (idoc as any).fonts.ready
              ? (idoc as any).fonts.ready
              : Promise.resolve();
          const imgs = Array.from(idoc.images || []) as HTMLImageElement[];
          const imgsReady = new Promise<void>((resolve) => {
            if (!imgs.length) {
              resolve();
              return;
            }
            let remaining = imgs.length;
            const markDone = () => {
              remaining--;
              if (remaining <= 0) resolve();
            };
            imgs.forEach((im) => {
              if (im.complete && im.naturalWidth !== 0) {
                markDone();
              } else {
                const onload = () => {
                  cleanup();
                  markDone();
                };
                const onerror = () => {
                  cleanup();
                  markDone();
                };
                const cleanup = () => {
                  im.removeEventListener("load", onload);
                  im.removeEventListener("error", onerror);
                };
                im.addEventListener("load", onload);
                im.addEventListener("error", onerror);
              }
            });
            // safety timeout: resolve anyway after timeoutMs
            setTimeout(() => resolve(), timeoutMs);
          });
          // Wait for fonts and images (but bounded by the imgsReady timeout above).
          await Promise.all([fontsReadyPromise.catch(() => {}), imgsReady]);
          // small delay to allow the layout to settle
          await new Promise((r) => setTimeout(r, 50));
        }

        if (signal.aborted) throw new Error("Export aborted");

        // Ensure color functions are fixed in the iframe document as well
        try {
          scanAndFixLabColorsInDoc(idoc);
        } catch {
          // ignore
        }

        // Reflow iframe to match full content height so we can capture the entire document
        const bodyEl = idoc.body as HTMLElement;
        const contentHeightCssPx = Math.max(
          bodyEl.scrollHeight ||
            bodyEl.clientHeight ||
            Math.round(mmToPx(pageHeightMm)),
          Math.round(mmToPx(pageHeightMm))
        );
        // Resize iframe to the content height so html2canvas captures the full document
        try {
          iframe.style.height = `${Math.ceil(contentHeightCssPx)}px`;
        } catch {
          // ignore: failure to set iframe height is non-critical for export
        }

        // Compute scale so the rendered canvas maps to the PDF page dimensions.
        // Use a higher export DPI to increase output resolution (default: 300 DPI).
        const PREFERRED_DPI = 300;
        // CSS px width for iframe sizing (uses 96dpi baseline)
        const targetCssPxWidth = mmToPx(pageWidthMm);
        // target pixel width at preferred DPI (px = mm * dpi / 25.4)
        const targetPxWidth = (pageWidthMm * PREFERRED_DPI) / 25.4;
        const bodyWidth = Math.max(
          1,
          bodyEl.scrollWidth || bodyEl.clientWidth || targetCssPxWidth
        );
        // scale to match target width at preferred DPI (may be >> 1), ensure at least 1
        const scale = Math.max(1, targetPxWidth / bodyWidth);

        // Call html2canvas on the iframe's body with a guarded timeout and explicit window reference.
        // Set a white background to avoid black bars when converting to JPEG/PNG.
        const html2canvasOptions: any = {
          scale,
          useCORS: true,
          backgroundColor: "#ffffff",
          // Ensure the virtual window matches the full document size
          windowWidth: bodyEl.scrollWidth,
          windowHeight: bodyEl.scrollHeight,
          // Explicitly render the full element, not just the viewport
          width: bodyEl.scrollWidth,
          height: contentHeightCssPx,
          // Avoid scroll offset affecting capture
          scrollX: 0,
          scrollY: 0,
        };
        if ((iframe as any).contentWindow) {
          html2canvasOptions.window = (iframe as any).contentWindow;
        }
        // Primary path: robust tiled per-page rendering
        try {
          const wrapper = document.createElement("div");
          wrapper.style.position = "fixed";
          wrapper.style.left = "-9999px";
          wrapper.style.top = "-9999px";
          wrapper.style.width = `${Math.round(mmToPx(pageWidthMm))}px`;
          wrapper.style.height = `${Math.round(mmToPx(pageHeightMm))}px`;
          wrapper.style.overflow = "hidden";
          wrapper.style.backgroundColor = "white";

          const mover = document.createElement("div");
          mover.style.willChange = "transform";
          mover.style.transform = "translateY(0px)";
          mover.style.width = "100%";
          // Use the sanitized iframe body innerHTML
          mover.innerHTML = bodyEl.innerHTML;
          wrapper.appendChild(mover);
          document.body.appendChild(wrapper);

          try {
            // Allow layout to settle
            await new Promise((r) => setTimeout(r, 100));
            // Ensure images inside the mover are loaded before measuring/painting
            const imgs = Array.from(
              mover.querySelectorAll("img")
            ) as HTMLImageElement[];
            if (imgs.length) {
              await new Promise<void>((resolve) => {
                let remaining = imgs.length;
                const done = () => {
                  remaining--;
                  if (remaining <= 0) resolve();
                };
                imgs.forEach((im) => {
                  if (im.complete && im.naturalWidth !== 0) {
                    done();
                  } else {
                    const onload = () => {
                      cleanup();
                      done();
                    };
                    const onerror = () => {
                      cleanup();
                      done();
                    };
                    const cleanup = () => {
                      im.removeEventListener("load", onload);
                      im.removeEventListener("error", onerror);
                    };
                    im.addEventListener("load", onload);
                    im.addEventListener("error", onerror);
                  }
                });
                // safety timeout
                setTimeout(() => resolve(), 4000);
              });
            }
            const pageCssPx = Math.round(mmToPx(pageHeightMm));
            // Compute scale based on wrapper width for crisp output
            const tiledScale = Math.max(
              1,
              targetPxWidth / (wrapper.scrollWidth || targetCssPxWidth)
            );

            // Pre-measure image rects relative to mover at transform=0
            const moverRect = mover.getBoundingClientRect();
            const imgRects = Array.from(mover.querySelectorAll("img"))
              .map((im) => {
                const r = im.getBoundingClientRect();
                const top = r.top - moverRect.top;
                const bottom = r.bottom - moverRect.top;
                return { top, bottom, height: bottom - top };
              })
              .sort((a, b) => a.top - b.top);

            let currentY = 0;
            let pageIdx = 0;
            while (currentY < contentHeightCssPx - 0.5) {
              if (signal.aborted) throw new Error("Export aborted");
              const tentativeEnd = Math.min(
                currentY + pageCssPx,
                contentHeightCssPx
              );
              // Find an image that would be split by the tentative end
              const crossing = imgRects.find(
                (r) =>
                  r.top < tentativeEnd &&
                  r.bottom > tentativeEnd &&
                  r.height <= pageCssPx
              );

              let translateStart: number;
              if (crossing) {
                // If the image begins near the page start, keep it whole on this page by aligning its bottom to page bottom
                if (crossing.top <= currentY + 4) {
                  translateStart = Math.max(
                    0,
                    Math.floor(crossing.bottom - pageCssPx)
                  );
                  // Ensure we still progress at least a few pixels when image is smaller than page
                  if (
                    translateStart < currentY &&
                    crossing.height <= pageCssPx
                  ) {
                    translateStart = currentY;
                  }
                  currentY = translateStart + pageCssPx;
                } else {
                  // End the current page before the image starts; capture [end - pageHeight, end)
                  const endY = Math.max(currentY, Math.floor(crossing.top));
                  translateStart = Math.max(0, endY - pageCssPx);
                  currentY = endY;
                }
              } else {
                // No crossing; natural paging
                translateStart = Math.floor(currentY);
                currentY = tentativeEnd;
              }

              mover.style.transform = `translateY(-${translateStart}px)`;
              await new Promise((r) => setTimeout(r, 20));

              const pageCanvas = await html2canvasLib(wrapper, {
                scale: tiledScale,
                useCORS: true,
                backgroundColor: "#ffffff",
                width: wrapper.clientWidth || wrapper.scrollWidth,
                height: pageCssPx,
                scrollX: 0,
                scrollY: 0,
              });

              const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
              if (i > 0 || pageIdx > 0) {
                if (opts.pageFormat === "A4") {
                  pdf.addPage("a4");
                } else {
                  pdf.addPage([
                    Math.round(pageWidthMm * 10) / 10,
                    Math.round(pageHeightMm * 10) / 10,
                  ]);
                }
              }
              pdf.addImage(
                imgData,
                "JPEG",
                0,
                0,
                pageWidthMm,
                pageHeightMm,
                undefined,
                "FAST"
              );

              pageIdx++;
            }

            // Done with this logical page; go to next without using the legacy tall-canvas path
            continue;
          } finally {
            try {
              wrapper.remove();
            } catch {}
          }
        } catch (primaryTileErr) {
          // If tiled rendering fails unexpectedly, fall back to legacy path below
        }
        const renderTimeoutMs = 15000;
        let canvas: HTMLCanvasElement;
        try {
          canvas = await Promise.race([
            html2canvasLib(bodyEl, html2canvasOptions),
            new Promise<HTMLCanvasElement>((_, reject) =>
              setTimeout(
                () => reject(new Error("html2canvas render timeout")),
                renderTimeoutMs
              )
            ),
          ]);
        } catch (e) {
          // Retry once with lower scale to avoid hangs/timeouts.
          try {
            emitProgress({
              stage: "render-retry",
              message: "Retrying render with lower scale",
            });
            const retryScale =
              typeof html2canvasOptions.scale === "number"
                ? Math.max(
                    1,
                    Math.round(html2canvasOptions.scale * 0.8 * 100) / 100
                  )
                : 1;
            const retryOptions = { ...html2canvasOptions, scale: retryScale };
            const retryTimeoutMs = 12000;
            canvas = await Promise.race([
              html2canvasLib(bodyEl, retryOptions),
              new Promise<HTMLCanvasElement>((_, reject) =>
                setTimeout(
                  () => reject(new Error("html2canvas render timeout")),
                  retryTimeoutMs
                )
              ),
            ]);
          } catch (e2) {
            // Final robust fallback: tile-render pages by translating content
            emitProgress({
              stage: "render-fallback",
              message: "Tiled render per page (robust fallback)",
            });

            // Build a same-origin wrapper and a mover inside to translate content
            const wrapper = document.createElement("div");
            wrapper.style.position = "fixed";
            wrapper.style.left = "-9999px";
            wrapper.style.top = "-9999px";
            wrapper.style.width = `${Math.round(mmToPx(pageWidthMm))}px`;
            wrapper.style.height = `${Math.round(mmToPx(pageHeightMm))}px`;
            wrapper.style.overflow = "hidden";
            wrapper.style.backgroundColor = "white";

            const mover = document.createElement("div");
            mover.style.willChange = "transform";
            mover.style.transform = "translateY(0px)";
            mover.style.width = "100%";
            mover.innerHTML = bodyEl.innerHTML;
            wrapper.appendChild(mover);
            document.body.appendChild(wrapper);

            try {
              // Allow a moment for layout and fonts in parent doc
              await new Promise((r) => setTimeout(r, 200));

              const totalHeight = Math.max(
                mover.scrollHeight,
                mover.clientHeight,
                Math.round(mmToPx(pageHeightMm))
              );
              const pageCssPx = Math.round(mmToPx(pageHeightMm));
              const pagesNeeded = Math.max(
                1,
                Math.ceil(totalHeight / pageCssPx)
              );

              const fallbackScale = Math.max(
                1,
                targetPxWidth / (wrapper.scrollWidth || targetCssPxWidth)
              );
              const fallbackTimeoutMs = 12000;

              // Create a blank canvas to satisfy later usage; actual per-page canvases will be created in the loop
              // We still set `canvas` to a dummy 1x1 to avoid referencing before assignment later
              canvas = document.createElement("canvas");
              canvas.width = 1;
              canvas.height = 1;

              for (let pageIdx = 0; pageIdx < pagesNeeded; pageIdx++) {
                if (signal.aborted) throw new Error("Export aborted");
                const offsetY = pageIdx * pageCssPx;
                mover.style.transform = `translateY(-${offsetY}px)`;
                // Allow transform to apply
                await new Promise((r) => setTimeout(r, 30));

                const pageCanvas = await Promise.race([
                  html2canvasLib(wrapper, {
                    scale: fallbackScale,
                    useCORS: true,
                    backgroundColor: "#ffffff",
                    width: wrapper.scrollWidth,
                    height: pageCssPx,
                    scrollX: 0,
                    scrollY: 0,
                  }),
                  new Promise<HTMLCanvasElement>((_, reject) =>
                    setTimeout(
                      () => reject(new Error("html2canvas render timeout")),
                      fallbackTimeoutMs
                    )
                  ),
                ]);

                // Convert to image and add to PDF immediately
                const imgData = pageCanvas.toDataURL("image/png");
                if (i > 0 || s > 0 || pageIdx > 0) {
                  if (opts.pageFormat === "A4") {
                    pdf.addPage("a4");
                  } else {
                    pdf.addPage([
                      Math.round(pageWidthMm * 10) / 10,
                      Math.round(pageHeightMm * 10) / 10,
                    ]);
                  }
                }
                pdf.addImage(
                  imgData,
                  "PNG",
                  0,
                  0,
                  pageWidthMm,
                  pageHeightMm,
                  undefined,
                  "FAST"
                );
              }

              // Skip the standard slicing path since we've already added pages
              continue;
            } finally {
              try {
                wrapper.remove();
              } catch {}
            }
          }
        }

        if (signal.aborted) throw new Error("Export aborted");

        // We may have a very tall canvas (full document). Slice it vertically into page-sized images
        // so content naturally flows across PDF pages without distortion.
        const pageHeightCanvasPx = (pageHeightMm * PREFERRED_DPI) / 25.4;
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;
        const slices = Math.max(
          1,
          Math.ceil(canvasHeight / pageHeightCanvasPx)
        );

        for (let s = 0; s < slices; s++) {
          if (signal.aborted) throw new Error("Export aborted");
          const startY = Math.round(s * pageHeightCanvasPx);
          const sliceHeight = Math.min(
            Math.round(pageHeightCanvasPx),
            canvasHeight - startY
          );

          // Create a page-sized canvas and draw the slice into it. Ensure white background so short content doesn't show transparent/black.
          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = canvasWidth;
          pageCanvas.height = Math.round(pageHeightCanvasPx); // always full page height
          const ctx = pageCanvas.getContext("2d");
          if (!ctx) throw new Error("Failed to create canvas context");
          // Fill white background
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

          // Draw the slice (if the last slice is shorter, it will be drawn at the top and the remaining area stays white).
          ctx.drawImage(
            canvas,
            0,
            startY,
            canvasWidth,
            sliceHeight,
            0,
            0,
            pageCanvas.width,
            sliceHeight
          );

          const imgData = pageCanvas.toDataURL("image/png");

          if (i > 0 || s > 0) {
            if (opts.pageFormat === "A4") {
              pdf.addPage("a4");
            } else {
              pdf.addPage([
                Math.round(pageWidthMm * 10) / 10,
                Math.round(pageHeightMm * 10) / 10,
              ]);
            }
          }
          // Add image filling the page
          pdf.addImage(
            imgData,
            "PNG",
            0,
            0,
            pageWidthMm,
            pageHeightMm,
            undefined,
            "FAST"
          );
        }
      } finally {
        // Cleanup iframe
        try {
          iframe.remove();
        } catch {}
      }
    }

    emitProgress({ stage: "assemble", message: "Assembling PDF" });
    if (signal.aborted) throw new Error("Export aborted");

    // Output blob and trigger download
    const blob = pdf.output ? pdf.output("blob") : null;
    if (!blob) {
      // fallback: use datauri string
      try {
        const dataUri = pdf.output("datauristring");
        const parts = dataUri.split(",");
        const byteString = atob(parts[1]);
        const ia = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++)
          ia[i] = byteString.charCodeAt(i);
        const fallbackBlob = new Blob([ia], { type: "application/pdf" });
        await triggerDownload(fallbackBlob, fileName);
      } catch (e) {
        throw new Error("Failed to generate PDF blob");
      }
    } else {
      await triggerDownload(blob as Blob, fileName);
    }

    emitProgress({ stage: "done", message: "PDF export complete" });
  } catch (e: any) {
    // propagate abort as a clear error so callers can show friendly message
    if (e && e.message === "Export aborted") {
      emitProgress({ stage: "aborted", message: "Export cancelled" });
      throw e;
    }
    emitProgress({ stage: "error", message: e?.message || String(e) });
    throw e;
  } finally {
    // Clear abort controller
    try {
      currentAbort = null;
    } catch {}
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
