"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui";

export function DownloadButton({
  content,
  filename,
  mime = "text/markdown",
  label = "Download",
  variant = "secondary",
}: {
  content: string;
  filename: string;
  mime?: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={() => {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download size={16} />
      {label}
    </Button>
  );
}
