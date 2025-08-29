// __mocks__/jspdf.ts
// Minimal mock for jspdf used in unit tests.

export const instances: any[] = [];

class MockPDF {
  public addImageCalls: any[] = [];
  public addPageCalls = 0;
  public savedFilename: string | null = null;
  constructor(opts: any) {
    // capture options if needed
    this.opts = opts;
  }
  opts: any;
  addPage() {
    this.addPageCalls += 1;
  }
  addImage(
    dataUrl: string,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number
  ) {
    this.addImageCalls.push({ dataUrl, format, x, y, w, h });
  }
  save(filename: string) {
    this.savedFilename = filename;
  }
}

export function jsPDF(opts: any) {
  const inst = new MockPDF(opts);
  instances.push(inst);
  return inst;
}
