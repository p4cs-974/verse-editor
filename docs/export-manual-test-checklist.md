# Export Feature — Manual Test Checklist

Prerequisites

- Ensure local dev server running: npm run dev
- If testing PDF export, install dependencies: npm i html2canvas jspdf

Files referenced

- Toolbar button UI: [`components/ui/export-toolbar-button.tsx`](components/ui/export-toolbar-button.tsx:1)
- Export settings UI: [`components/ui/export-settings-button.tsx`](components/ui/export-settings-button.tsx:1)
- Export utilities: [`lib/export-utils.ts`](lib/export-utils.ts:1)
- Preview panel: [`components/preview-panel.tsx`](components/preview-panel.tsx:1)

Quick smoke tests

1. Open app in browser at http://localhost:3000 (or your dev URL).
2. Confirm toolbar shows Export and Export Settings buttons (hover/tap).

Settings persistence

- Open Export Settings and toggle Pagination on, set Page format to A4.
- Close and reload page.
- Re-open settings and confirm pagination=true and pageFormat=A4 persisted.
- Verify localStorage keys: `export-settings:<docId>` or `export-settings:global`.

Export actions — HTML

1. Open a document in the editor so preview shows content (images, fonts).
2. Click Export → Export as HTML + CSS.
3. Popover should show "Preparing export…" then download a .html file.
4. Open downloaded file in a browser (file://) and confirm visual fidelity.

Export actions — Markdown

1. Click Export → Export as Markdown.
2. Confirm .md file downloaded and contains markdownContent.

Export actions — PDF

1. Ensure dependencies installed: npm i html2canvas jspdf
2. Click Export → Export as PDF.
3. Popover should show progress stages: "Loading dependencies..." → "Rendering..." → "Rendering page X of Y" → Download a .pdf file.
4. Open PDF and verify layout, images, fonts, and pagination per settings.
5. If dependencies are missing, expect clear error messages with install instructions.

Keyboard & Accessibility

- Focus toolbar, press Enter/Space to open Export menu.
- Use ArrowDown/ArrowUp to move between menu items; Enter to select.
- Press Escape to close menu.
- Press Cmd+E globally to open Export menu (ensure focus not in input).

Cross-origin images & fonts

- Add an image hosted on a different domain without CORS headers.
- Export HTML/PDF and observe warning in popover and placeholder image in exported output.

Long documents & performance

- For very long content (>50 pages) expect long processing time or a warning.
- If export hangs or memory errors, try Export as HTML or Markdown as fallback.

Debugging tips

- If PDF export throws: confirm html2canvas and jspdf are installed.
- Inspect browser console for exportProgress warnings.

Report results

- Copy any console errors / screenshots and paste them here so I can iterate on fixes.
