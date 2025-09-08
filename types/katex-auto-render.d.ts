/* Ambient types for KaTeX auto-render since the package doesn't ship its own types */
declare module "katex/contrib/auto-render" {
  export interface RenderMathInElementOptions {
    delimiters?: Array<{ left: string; right: string; display: boolean }>;
    ignoredTags?: string[];
    ignoredClasses?: string[];
    errorCallback?: (msg: string, err: unknown) => void;
    throwOnError?: boolean;
    strict?:
      | boolean
      | "warn"
      | "ignore"
      | ((errorCode: string, errorMsg: string, token?: string) => boolean);
    macros?: Record<string, string>;
    trust?: boolean | ((context: { command: string; url?: string }) => boolean);
  }
  const renderMathInElement: (
    element: HTMLElement,
    options?: RenderMathInElementOptions
  ) => void;
  export default renderMathInElement;
}
