"use client";

import { ArrowUpRight } from "lucide-react";

export default function Footer() {
  return (
    <footer
      className="fixed left-0 right-0 bottom-0 border-t bg-background/90 backdrop-blur py-4"
      role="contentinfo"
      aria-label="Site footer"
    >
      <div className="mx-auto flex h-10 w-full max-w-6xl items-center justify-between">
        {/* Left side */}
        <div className="flex items-center space-x-2">
          <p className="text-sm text-muted-foreground">Built by P4CS</p>
        </div>

        {/* Right side */}
        <div className="flex items-center space-x-2">
          <a
            href="https://p4cs.com.br"
            className="underline text-sm text-muted-foreground flex items-center hover:text-foreground transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            p4cs.com.br
            <ArrowUpRight className="ml-1 h-4 w-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}
