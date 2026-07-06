"use client";

// Admin stat card: the number counts up from 0 (~900ms ease-out) on mount and
// the card fades in with a per-index stagger. Serif display figure per the
// Ember spec.

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";

type Format = "currency" | "compact" | "number";

function formatValue(n: number, format: Format): string {
  if (format === "currency") return `$${n.toFixed(2)}`;
  if (format === "compact")
    return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  return Math.round(n).toLocaleString();
}

export function AdminStat({
  label,
  value,
  format = "number",
  sub,
  index = 0,
}: {
  label: string;
  value: number;
  format?: Format;
  sub?: string;
  index?: number;
}) {
  const [display, setDisplay] = useState(0);
  const [shown, setShown] = useState(false);
  const raf = useRef<number | undefined>(undefined);

  useEffect(() => {
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(value * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    const id = setTimeout(() => setShown(true), index * 60);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      clearTimeout(id);
    };
  }, [value, index]);

  return (
    <Card
      className="p-5 transition-[opacity,transform] duration-500 ease-ember-out"
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(12px)",
      }}
    >
      <div className="text-xs uppercase tracking-wide text-ember-faint">{label}</div>
      <div className="mt-1 font-serif text-[28px] font-semibold text-ember-text">
        {formatValue(display, format)}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ember-faint">{sub}</div>}
    </Card>
  );
}
