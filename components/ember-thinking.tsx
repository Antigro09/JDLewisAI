// The "thinking" loader — a breathing ember-glow orb (two counter-pulsing
// concentric circles) beside a shimmering label. The product's signature
// waiting moment. Pure presentational; drive `label` off the stream phase.

export function EmberOrb({ size = 22 }: { size?: number }) {
  return (
    <span
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="absolute inset-0 rounded-full bg-ember-accent"
        style={{ filter: "blur(5px)", animation: "emb-ember-a 1.3s ease-in-out infinite" }}
      />
      <span
        className="absolute rounded-full bg-ember-accent-solid"
        style={{
          inset: size * 0.25,
          animation: "emb-ember-b 1.7s ease-in-out infinite",
        }}
      />
    </span>
  );
}

export function EmberThinking({ label = "Thinking" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <EmberOrb />
      <span className="emb-shimmer text-[15px] font-medium">{label}</span>
    </div>
  );
}
