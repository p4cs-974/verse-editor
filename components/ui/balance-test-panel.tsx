/* Balance test UI removed — backend test mutations disabled.
   Keep a small notice here so pages that import the panel render cleanly. */

"use client";

import { Card } from "./card";

/**
 * Renders a non-interactive notice indicating that balance testing is disabled.
 *
 * Displays a small card with a header and explanatory text that backend balance
 * test helpers were removed and that real top-up/checkout flows should be used.
 * This component has no props or side effects and is intended as a static UI
 * placeholder for pages that import the panel.
 */
export function BalanceTestPanel() {
  return (
    <Card className="p-4 space-y-4">
      <h3 className="font-semibold text-lg">Balance Testing (Disabled)</h3>

      <div className="text-sm">
        Balance test helpers have been removed from the backend. To add real
        balance in development or production, use the regular top-up / checkout
        flow. This panel is intentionally disabled to avoid exposing test-only
        mutations.
      </div>
    </Card>
  );
}
