"use client";

// A self-contained, static mock of the ContractorAI product app, shown inside
// the hero's floating "product shot". The design prototype embedded a live
// <iframe> of the app here; a real embed would require auth, so on the public
// landing page we render this always-available preview instead (the handoff
// explicitly allows a screenshot/static preview). It reuses the page's theme
// tokens so it re-themes with the toggle.

import {
  MessageSquare,
  FolderOpen,
  AudioLines,
  Workflow,
  SlidersHorizontal,
  Shield,
  Settings,
  Search,
  Plus,
  Paperclip,
  ArrowUp,
  Zap,
  ChevronDown,
} from "lucide-react";
import type { Tokens } from "./tokens";

const NAV = [
  { icon: MessageSquare, label: "Chat", active: true },
  { icon: FolderOpen, label: "Projects", active: false },
  { icon: AudioLines, label: "Meetings", active: false },
  { icon: Workflow, label: "Automations", active: false },
  { icon: SlidersHorizontal, label: "Customize", active: false },
];

export function ProductPreview({ t }: { t: Tokens }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: t.bg,
        color: t.text,
        fontSize: "11px",
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: "27%",
          minWidth: 0,
          background: t.surface,
          borderRight: `1px solid ${t.border}`,
          display: "flex",
          flexDirection: "column",
          padding: "14px 12px",
          gap: 10,
        }}
      >
        {/* Logo row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              background: t.accentSolid,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-serif)",
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            C
          </div>
          <span style={{ fontWeight: 600, fontSize: 12, letterSpacing: "-0.01em" }}>
            ContractorAI
          </span>
        </div>

        {/* Find a tool */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 9px",
            borderRadius: 9999,
            background: t.subtleBg,
            color: t.textFaint,
            fontSize: 10.5,
          }}
        >
          <Search size={12} />
          Find a tool…
        </div>

        {/* Primary nav */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "6px 9px",
                borderRadius: 9,
                fontSize: 11,
                fontWeight: active ? 600 : 500,
                background: active ? t.accentTint : "transparent",
                color: active ? t.accentTintText : t.textMuted,
              }}
            >
              <Icon size={14} />
              {label}
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Secondary nav */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {[
            { icon: Shield, label: "Admin" },
            { icon: Settings, label: "Settings" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "6px 9px",
                borderRadius: 9,
                fontSize: 11,
                color: t.textMuted,
              }}
            >
              <Icon size={14} />
              {label}
            </div>
          ))}
        </div>

        {/* User footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingTop: 8,
            borderTop: `1px solid ${t.border}`,
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 9999,
              background: t.accentTint,
              color: t.accentTintText,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 700,
            }}
          >
            JD
          </div>
          <div style={{ lineHeight: 1.2, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600 }}>Jordan Diaz</div>
            <div style={{ fontSize: 9, color: t.textFaint }}>Admin</div>
          </div>
        </div>
      </div>

      {/* Chat column */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          padding: "22px 20px 14px",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            maxWidth: 420,
            width: "100%",
            margin: "0 auto",
          }}
        >
          {/* User bubble */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div
              style={{
                background: t.accentSolid,
                color: "#fff",
                borderRadius: "16px 16px 5px 16px",
                padding: "9px 13px",
                fontSize: 12,
                maxWidth: "82%",
                boxShadow: `0 4px 14px ${t.accentShadow}`,
              }}
            >
              Review the Summit Electrical invoice for the Maple St. project.
            </div>
          </div>

          {/* Assistant: tool-activity chip */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                alignSelf: "flex-start",
                background: t.subtleBg,
                borderRadius: 10,
                padding: "6px 10px",
                fontSize: 10.5,
                color: t.textMuted,
              }}
            >
              <Zap size={12} color={t.accent} fill={t.accent} />
              Read invoice · Summit Electrical Supply
              <span style={{ color: t.accent, fontWeight: 600 }}>Open</span>
            </div>

            {/* Answer */}
            <div style={{ fontSize: 12, lineHeight: 1.7, color: t.text }}>
              The invoice totals <strong>$4,210.00</strong> across 6 line items.
              One flag: unit price on breakers is{" "}
              <strong>18% above</strong> your last three orders.
              <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                <span style={{ color: t.accent, fontWeight: 700 }}>→</span>
                <span style={{ color: t.textMuted }}>
                  Recommend flagging for review before approval.
                </span>
              </div>
            </div>

            {/* Ember "thinking" signature moment */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
              <div style={{ position: "relative", width: 20, height: 20 }}>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 9999,
                    background: t.accent,
                    filter: "blur(5px)",
                    animation: "hm-ember-a 1.3s ease-in-out infinite",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 5,
                    borderRadius: 9999,
                    background: t.accentSolid,
                    animation: "hm-ember-b 1.7s ease-in-out infinite",
                  }}
                />
              </div>
              <span style={{ fontSize: 11.5, color: t.textFaint, fontWeight: 500 }}>
                Checking project context
              </span>
            </div>
          </div>
        </div>

        {/* Composer */}
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            margin: "14px auto 0",
            border: `1px solid ${t.border}`,
            background: t.surface,
            borderRadius: 18,
            padding: "10px 12px",
            boxShadow: t.cardShadow,
          }}
        >
          <div style={{ fontSize: 11.5, color: t.textFaint, marginBottom: 9 }}>
            Ask ContractorAI anything…
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Plus size={15} color={t.textFaint} />
            <Paperclip size={15} color={t.textFaint} />
            <div style={{ flex: 1 }} />
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                fontSize: 10.5,
                fontWeight: 600,
                color: t.textMuted,
                background: t.subtleBg,
                borderRadius: 9999,
                padding: "3px 8px",
              }}
            >
              Sonnet 4.6
              <ChevronDown size={11} />
            </div>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 9999,
                background: t.accentSolid,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ArrowUp size={14} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
