/* Balance test UI removed — backend test mutations disabled.
   Keep a small notice here so pages that import the panel render cleanly. */

"use client";

import { Card } from "./card";

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
