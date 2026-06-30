"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function PrintButton() {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="no-print"
      onClick={() => window.print()}
    >
      <Printer size={16} />
      Print / Save as PDF
    </Button>
  );
}
