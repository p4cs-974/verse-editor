// __mocks__/html2canvas.ts
// Simple synchronous mock of html2canvas for unit tests.
// Returns a promise resolving to a canvas-like object.
export default function html2canvas(element: Element, opts: any = {}) {
  return Promise.resolve({
    width: opts.width || 800,
    height: opts.height || 600,
    toDataURL: (type = "image/png", quality?: number) => {
      // Return a predictable data URL for assertions
      return "data:image/jpeg;base64,TEST_CANVAS_DATA";
    },
  });
}
