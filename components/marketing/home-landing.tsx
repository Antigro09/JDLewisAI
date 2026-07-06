"use client";

// ContractorAI marketing home page — recreated from the ContractorAI-Home
// design prototype. Public, pre-sign-up landing page: editorial hero with a
// live product preview, a scroll-pinned "how it works" sequence, a feature
// bento grid, a platforms strip, and a closing CTA. Theme is driven through
// next-themes so the toggle here persists app-wide.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Sparkles,
  ArrowRight,
  Sun,
  Moon,
  Paperclip,
  Brain,
  CircleCheckBig,
  DraftingCompass,
  ReceiptText,
  Map as MapIcon,
  Siren,
  Globe,
  Smartphone,
  Monitor,
  type LucideIcon,
} from "lucide-react";
import { EASE_OUT, clamp, getTokens, type Tokens } from "./tokens";
import { ProductPreview } from "./product-preview";

const GET_STARTED_HREF = "/signup";
const SIGN_IN_HREF = "/login";

type Feature = {
  icon: LucideIcon;
  title: string;
  desc: string;
  span: string; // Tailwind responsive grid-span classes
  chips?: string[];
  preview?: { label: string; value: string }[];
};

const FEATURES: Feature[] = [
  {
    icon: DraftingCompass,
    title: "Scope of Work",
    desc: "Pick from 32 trades — get a complete, structured scope in seconds: work included, exclusions, assumptions, permits, closeout.",
    span: "min-[760px]:col-span-4 min-[760px]:row-span-2",
    chips: ["Electrical", "Concrete", "Framing", "Drywall", "+28 more"],
  },
  {
    icon: ReceiptText,
    title: "Invoice Review",
    desc: "Upload an invoice. It extracts every line item and recommends an action.",
    span: "min-[760px]:col-span-2 min-[760px]:row-span-2",
    preview: [
      { label: "Vendor", value: "Summit Electrical" },
      { label: "Total", value: "$4,210.00" },
      { label: "Status", value: "Needs Review" },
    ],
  },
  {
    icon: MapIcon,
    title: "Plan Reader",
    desc: "Hand it a floor, electrical, structural, or MEP plan — it reads the drawing and writes up what it finds.",
    span: "min-[760px]:col-span-3",
  },
  {
    icon: Siren,
    title: "Emergency Action Plan",
    desc: "Generate a complete EAP from your company template — routes, assembly points, contacts.",
    span: "min-[760px]:col-span-3",
  },
];

const PLATFORMS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Globe, title: "Web", desc: "Installable, works in any browser" },
  { icon: Smartphone, title: "Mobile", desc: "iOS & Android" },
  { icon: Monitor, title: "Desktop", desc: "Windows, auto-updating" },
];

const STEPS: { icon: LucideIcon; label: string; text: string }[] = [
  {
    icon: Paperclip,
    label: "Attach anything",
    text: "A scope, an invoice, a set of plans, a photo from the field — drop it in the chat.",
  },
  {
    icon: Brain,
    label: "It reads the room",
    text: "Grounded in your projects, your standards, your history — not a generic answer.",
  },
  {
    icon: CircleCheckBig,
    label: "Get exactly what you need",
    text: "A structured scope, a reviewed invoice, a written-up finding — ready to use.",
  },
];

type RippleKey = "nav" | "hero" | "cta";
type Ripple = { id: number; key: RippleKey; x: number; y: number };
type XY = { x: number; y: number };
type Glow = { x: number; y: number; active: boolean };

const SERIF = "var(--font-serif), ui-serif, Georgia, serif";

export function HomeLanding() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const [viewportWidth, setViewportWidth] = useState(1440);
  const [scrollY, setScrollY] = useState(0);
  const [pinProgress, setPinProgress] = useState(0);
  const [heroTextProgress, setHeroTextProgress] = useState(0);
  const [heroShotProgress, setHeroShotProgress] = useState(0);
  const [revealed, setRevealed] = useState({
    features: false,
    platforms: false,
    cta: false,
  });
  const [magnet, setMagnet] = useState<Record<RippleKey, XY>>({
    nav: { x: 0, y: 0 },
    hero: { x: 0, y: 0 },
    cta: { x: 0, y: 0 },
  });
  const [glow, setGlow] = useState<{ hero: Glow; cta: Glow }>({
    hero: { x: 0, y: 0, active: false },
    cta: { x: 0, y: 0, active: false },
  });
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const featuresRef = useRef<HTMLDivElement>(null);
  const platformsRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const pinTrackRef = useRef<HTMLDivElement>(null);
  const heroTextRef = useRef<HTMLDivElement>(null);
  const heroShotRef = useRef<HTMLDivElement>(null);
  const rippleId = useRef(0);
  const reducedMotion = useRef(false);

  useEffect(() => setMounted(true), []);

  // Resize → viewport width (drives which pointer effects are enabled).
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // rAF-throttled scroll handler: hero recede, parallax, pinned progress.
  useEffect(() => {
    reducedMotion.current =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const rm = reducedMotion.current;
        const nextScrollY = rm ? 0 : window.scrollY;

        let nextPin = 0;
        if (pinTrackRef.current) {
          const rect = pinTrackRef.current.getBoundingClientRect();
          const total = rect.height - window.innerHeight;
          nextPin = total > 0 ? clamp(-rect.top / total, 0, 1) : 0;
        }

        // Each hero element recedes based on ITS OWN position — fully visible
        // while on screen, only receding once its top scrolls past the edge.
        let nextText = 0;
        let nextShot = 0;
        if (!rm) {
          if (heroTextRef.current) {
            nextText = clamp(
              -heroTextRef.current.getBoundingClientRect().top / 380,
              0,
              1,
            );
          }
          if (heroShotRef.current) {
            nextShot = clamp(
              -heroShotRef.current.getBoundingClientRect().top / 520,
              0,
              1,
            );
          }
        }

        setScrollY(nextScrollY);
        setPinProgress(nextPin);
        setHeroTextProgress(nextText);
        setHeroShotProgress(nextShot);
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-reveal sections.
  useEffect(() => {
    const pairs: [keyof typeof revealed, typeof featuresRef][] = [
      ["features", featuresRef],
      ["platforms", platformsRef],
      ["cta", ctaRef],
    ];
    const observers: IntersectionObserver[] = [];
    pairs.forEach(([key, ref]) => {
      if (!ref.current) return;
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              setRevealed((s) => ({ ...s, [key]: true }));
              obs.unobserve(e.target);
            }
          });
        },
        { threshold: 0.12 },
      );
      obs.observe(ref.current);
      observers.push(obs);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const dark = mounted && resolvedTheme === "dark";
  const isMobile = mounted && viewportWidth < 760;
  const t = getTokens(dark);

  const toggleTheme = useCallback(
    () => setTheme(dark ? "light" : "dark"),
    [dark, setTheme],
  );

  const onMagnetMove = useCallback(
    (key: RippleKey, e: ReactMouseEvent) => {
      if (reducedMotion.current || isMobile) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = e.clientX - (rect.left + rect.width / 2);
      const relY = e.clientY - (rect.top + rect.height / 2);
      const x = clamp(relX * 0.3, -9, 9);
      const y = clamp(relY * 0.3, -9, 9) - 2;
      setMagnet((s) => ({ ...s, [key]: { x, y } }));
    },
    [isMobile],
  );
  const onMagnetLeave = useCallback((key: RippleKey) => {
    setMagnet((s) => ({ ...s, [key]: { x: 0, y: 0 } }));
  }, []);

  const onGlowMove = useCallback(
    (key: "hero" | "cta", e: ReactMouseEvent) => {
      if (reducedMotion.current || isMobile) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setGlow((s) => ({
        ...s,
        [key]: { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true },
      }));
    },
    [isMobile],
  );
  const onGlowLeave = useCallback((key: "hero" | "cta") => {
    setGlow((s) => ({ ...s, [key]: { ...s[key], active: false } }));
  }, []);

  const onCtaClick = useCallback(
    (key: RippleKey, href: string, e: ReactMouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const id = ++rippleId.current;
      const ripple = { id, key, x: e.clientX - rect.left, y: e.clientY - rect.top };
      setRipples((s) => [...s, ripple]);
      setTimeout(
        () => setRipples((s) => s.filter((r) => r.id !== id)),
        650,
      );
      // Delay nav so the ripple reads (skipped for modified clicks above).
      setTimeout(() => router.push(href), 280);
    },
    [router],
  );

  // ---- derived styles ----
  const reveal = (shown: boolean): CSSProperties =>
    shown
      ? {
          opacity: 1,
          transform: "translateY(0)",
          transition: `opacity .8s ${EASE_OUT}, transform .8s ${EASE_OUT}`,
        }
      : { opacity: 0, transform: "translateY(36px)" };

  const revealClip = (shown: boolean): CSSProperties =>
    shown
      ? {
          opacity: 1,
          clipPath: "inset(0 0 0% 0)",
          transform: "translateY(0)",
          transition: `opacity .8s ${EASE_OUT}, clip-path .9s ${EASE_OUT}, transform .8s ${EASE_OUT}`,
        }
      : { opacity: 0, clipPath: "inset(0 0 100% 0)", transform: "translateY(20px)" };

  const cardReveal = (idx: number): CSSProperties => {
    const delay = idx * 70;
    return revealed.features
      ? {
          opacity: 1,
          transform: "translateY(0) scale(1)",
          transition: `opacity .6s ease ${delay}ms, transform .6s ${EASE_OUT} ${delay}ms`,
        }
      : { opacity: 0, transform: "translateY(22px) scale(0.97)" };
  };

  const magnetStyle = (m: XY): CSSProperties => ({
    transform: `translate(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px)`,
    transition: `transform .15s ${EASE_OUT}`,
    willChange: "transform",
  });

  const heroTextStyle: CSSProperties = {
    opacity: 1 - heroTextProgress,
    transform: `translateY(${(-heroTextProgress * 34).toFixed(1)}px) scale(${(1 - heroTextProgress * 0.04).toFixed(3)})`,
  };
  const heroShotOuterStyle: CSSProperties = {
    opacity: 1 - heroShotProgress * 0.9,
    transform: `translateY(${(heroShotProgress * 30).toFixed(1)}px) scale(${(1 - heroShotProgress * 0.05).toFixed(3)})`,
  };

  const stepFloat = pinProgress * STEPS.length;
  const glowOpacity = (g: Glow) => (g.active && !isMobile ? 0.9 : 0);

  const baseCard: CSSProperties = {
    borderRadius: 24,
    border: `1px solid ${t.border}`,
    background: t.surface,
    boxShadow: t.cardShadow,
    padding: 26,
    display: "flex",
    flexDirection: "column",
    willChange: "transform",
  };

  return (
    <div
      className="hm-root"
      style={{
        minHeight: "100vh",
        width: "100%",
        background: t.bg,
        color: t.text,
        fontFamily: "var(--font-hanken), ui-sans-serif, system-ui, sans-serif",
        WebkitFontSmoothing: "antialiased",
        overflowX: "clip",
        position: "relative",
      }}
    >
      {/* ---------- Floating pill nav ---------- */}
      <div
        style={{
          position: "fixed",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(980px, calc(100% - 24px))",
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "9px 12px 9px 16px",
          background: t.navBg,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${t.navBorder}`,
          borderRadius: 9999,
          boxShadow: t.navShadow,
        }}
      >
        <Link
          href="/"
          style={{ display: "flex", alignItems: "center", gap: 9, color: "inherit" }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              background: t.accentSolid,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              flexShrink: 0,
              fontFamily: SERIF,
            }}
          >
            C
          </span>
          <span style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: "-0.01em" }}>
            ContractorAI
          </span>
        </Link>
        <div style={{ flex: 1 }} />
        <a
          href="#how"
          className="hidden min-[760px]:inline"
          style={{ fontSize: 13.5, fontWeight: 500, color: t.textMuted, marginRight: 4 }}
        >
          How it works
        </a>
        <a
          href="#features"
          className="hidden min-[760px]:inline"
          style={{ fontSize: 13.5, fontWeight: 500, color: t.textMuted, marginRight: 8 }}
        >
          Features
        </a>
        <button
          onClick={toggleTheme}
          title="Toggle theme"
          aria-label="Toggle theme"
          style={{
            border: "none",
            background: t.pillBg,
            color: t.textFaint,
            display: "flex",
            padding: 7,
            cursor: "pointer",
            borderRadius: 9999,
          }}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <Link
          href={SIGN_IN_HREF}
          className="hidden min-[760px]:inline"
          style={{ fontSize: 13.5, fontWeight: 600, color: t.text, marginLeft: 2 }}
        >
          Sign in
        </Link>
        <Link
          href={GET_STARTED_HREF}
          onMouseMove={(e) => onMagnetMove("nav", e)}
          onMouseLeave={() => onMagnetLeave("nav")}
          onClick={(e) => onCtaClick("nav", GET_STARTED_HREF, e)}
          style={{
            position: "relative",
            overflow: "hidden",
            display: "inline-flex",
            alignItems: "center",
            height: 34,
            padding: "0 16px",
            borderRadius: 9999,
            background: t.accentSolid,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            boxShadow: `0 4px 14px ${t.accentShadow}`,
            ...magnetStyle(magnet.nav),
          }}
        >
          Get started
          {ripples
            .filter((r) => r.key === "nav")
            .map((r) => (
              <span key={r.id} style={rippleStyle(r, "#fff", 16)} />
            ))}
        </Link>
      </div>

      {/* ---------- HERO ---------- */}
      <div
        onMouseMove={(e) => onGlowMove("hero", e)}
        onMouseLeave={() => onGlowLeave("hero")}
        style={{
          position: "relative",
          padding: "clamp(128px,16vw,168px) 24px 0",
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}
        >
          <div
            style={{
              position: "absolute",
              top: -120,
              left: "50%",
              transform: `translateX(-62%) translateY(${(scrollY * 0.18).toFixed(1)}px)`,
              willChange: "transform",
            }}
          >
            <div
              style={{
                width: 640,
                height: 640,
                borderRadius: 9999,
                background: t.orbWarm,
                filter: "blur(90px)",
                animation: "hm-orb 12s ease-in-out infinite",
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              top: 60,
              left: "50%",
              transform: `translateX(28%) translateY(${(scrollY * -0.12).toFixed(1)}px)`,
              willChange: "transform",
            }}
          >
            <div
              style={{
                width: 520,
                height: 520,
                borderRadius: 9999,
                background: t.orbDeep,
                filter: "blur(100px)",
                animation: "hm-orb 15s ease-in-out infinite 2s",
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 340,
              height: 340,
              borderRadius: 9999,
              background: t.glowCursor,
              filter: "blur(60px)",
              opacity: glowOpacity(glow.hero),
              transform: `translate(${glow.hero.x}px,${glow.hero.y}px) translate(-50%,-50%)`,
              transition: "opacity .3s ease",
              willChange: "transform,opacity",
            }}
          />
        </div>

        <div
          ref={heroTextRef}
          style={{
            position: "relative",
            zIndex: 1,
            maxWidth: 880,
            margin: "0 auto",
            textAlign: "center",
            willChange: "transform,opacity",
            ...heroTextStyle,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              fontWeight: 600,
              color: t.accentTintText,
              background: t.accentTint,
              padding: "7px 16px",
              borderRadius: 9999,
              marginBottom: 28,
              animation: `hm-in .6s ${EASE_OUT} both`,
            }}
          >
            <Sparkles size={15} fill="currentColor" />
            AI built for construction teams
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: SERIF,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1.02,
              fontSize: "clamp(42px,8.6vw,108px)",
              animation: `hm-in .7s ${EASE_OUT} .08s both`,
            }}
          >
            Construction runs
            <br />
            on paperwork.
          </h1>
          <div style={{ position: "relative", display: "inline-block" }}>
            <h1
              style={{
                margin: "2px 0 0",
                fontFamily: SERIF,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                lineHeight: 1.02,
                fontSize: "clamp(42px,8.6vw,108px)",
                color: t.accent,
                animation: `hm-in .7s ${EASE_OUT} .16s both`,
              }}
            >
              ContractorAI reads it.
            </h1>
            <svg
              viewBox="0 0 340 14"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: -6,
                width: "100%",
                height: 14,
                overflow: "visible",
              }}
              aria-hidden="true"
            >
              <path
                d="M4,8 C60,1 110,14 172,7 C230,0 280,13 336,5"
                fill="none"
                stroke={t.accent}
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeDasharray={340}
                style={{ animation: `hm-draw 1s ${EASE_OUT} .7s both` }}
              />
            </svg>
          </div>
          <p
            style={{
              maxWidth: 540,
              margin: "26px auto 0",
              fontSize: "clamp(15px,1.7vw,18.5px)",
              lineHeight: 1.6,
              color: t.textMuted,
              animation: `hm-in .7s ${EASE_OUT} .28s both`,
            }}
          >
            Attach a scope, an invoice, a set of plans — get a grounded answer
            back, in your projects&apos; own context. One assistant for every
            document that crosses your desk.
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              marginTop: 34,
              flexWrap: "wrap",
              animation: `hm-in .7s ${EASE_OUT} .36s both`,
            }}
          >
            <Link
              href={GET_STARTED_HREF}
              onMouseMove={(e) => onMagnetMove("hero", e)}
              onMouseLeave={() => onMagnetLeave("hero")}
              onClick={(e) => onCtaClick("hero", GET_STARTED_HREF, e)}
              style={{
                position: "relative",
                overflow: "hidden",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                height: 50,
                padding: "0 28px",
                borderRadius: 9999,
                background: t.accentSolid,
                color: "#fff",
                fontSize: 15.5,
                fontWeight: 600,
                boxShadow: `0 10px 28px ${t.accentShadow}`,
                ...magnetStyle(magnet.hero),
              }}
            >
              Get started
              <ArrowRight size={19} />
              {ripples
                .filter((r) => r.key === "hero")
                .map((r) => (
                  <span key={r.id} style={rippleStyle(r, "#fff", 20)} />
                ))}
            </Link>
            <Link
              href={SIGN_IN_HREF}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 50,
                padding: "0 10px",
                fontSize: 15.5,
                fontWeight: 600,
                color: t.text,
              }}
            >
              Sign in
            </Link>
          </div>
        </div>

        {/* Floating product shot */}
        <div
          ref={heroShotRef}
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            justifyContent: "center",
            padding: "clamp(48px,7vw,84px) 0 0",
            willChange: "transform,opacity",
            ...heroShotOuterStyle,
          }}
        >
          <div style={{ width: "min(980px,92vw)", animation: `hm-in .8s ${EASE_OUT} .4s both` }}>
            <div style={{ animation: "hm-float 7s ease-in-out infinite" }}>
              <div className="hm-shot">
                <div
                  style={{
                    borderRadius: 28,
                    overflow: "hidden",
                    border: `1px solid ${t.shotBorder}`,
                    boxShadow: t.shotShadow,
                    aspectRatio: "980 / 610",
                    background: t.surface,
                    animation: `hm-clip-in 1s ${EASE_OUT} .55s both`,
                  }}
                >
                  <ProductPreview t={t} />
                </div>
              </div>
            </div>
          </div>
        </div>
        <p
          style={{
            position: "relative",
            zIndex: 1,
            textAlign: "center",
            fontSize: 12.5,
            color: t.textFaint,
            margin: "18px 0 0",
          }}
        >
          ↑ that&apos;s the redesigned product — sign in to try it live
        </p>
      </div>

      {/* ---------- PINNED "HOW IT WORKS" ---------- */}
      <div id="how" ref={pinTrackRef} style={{ position: "relative", height: "320vh" }}>
        <div
          style={{
            position: "sticky",
            top: 0,
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div style={{ maxWidth: 640, margin: "0 auto", padding: 24, textAlign: "center", width: "100%" }}>
            <div style={eyebrow(t)}>How it works</div>
            <div style={{ position: "relative", height: 280 }}>
              {STEPS.map((s, i) => {
                const dist = Math.abs(stepFloat - (i + 0.5));
                const opacity = clamp(1 - dist * 1.35, 0, 1);
                const translate = clamp((stepFloat - (i + 0.5)) * 46, -70, 70);
                const Icon = s.icon;
                return (
                  <div
                    key={s.label}
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      willChange: "transform,opacity",
                      opacity,
                      transform: `translateY(${translate.toFixed(1)}px)`,
                    }}
                  >
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 18,
                        background: t.accentTint,
                        color: t.accentTintText,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 22,
                      }}
                    >
                      <Icon size={30} />
                    </div>
                    <div
                      style={{
                        fontFamily: SERIF,
                        fontWeight: 600,
                        fontSize: "clamp(22px,3.4vw,32px)",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {s.label}
                    </div>
                    <p style={{ maxWidth: 440, margin: "12px 0 0", fontSize: 15, lineHeight: 1.55, color: t.textMuted }}>
                      {s.text}
                    </p>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 20,
                height: 3,
                borderRadius: 9999,
                background: t.border,
                overflow: "hidden",
                maxWidth: 220,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: "100%",
                  background: t.accentSolid,
                  transform: `scaleX(${pinProgress.toFixed(3)})`,
                  transformOrigin: "left center",
                  willChange: "transform",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ---------- FEATURES — bento ---------- */}
      <div
        ref={featuresRef}
        id="features"
        style={{ maxWidth: 1120, margin: "0 auto", padding: "clamp(48px,8vw,88px) 24px 24px", scrollMarginTop: 24 }}
      >
        <div style={{ textAlign: "center", maxWidth: 560, margin: "0 auto 44px", overflow: "hidden" }}>
          <div style={revealClip(revealed.features)}>
            <div style={eyebrow(t, 12)}>Built for the job</div>
            <h2
              style={{
                margin: 0,
                fontFamily: SERIF,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                fontSize: "clamp(28px,4.2vw,44px)",
              }}
            >
              Four tools your team opens every day
            </h2>
          </div>
        </div>
        <div
          className="grid grid-cols-1 min-[760px]:grid-cols-6"
          style={{ gridAutoRows: "minmax(150px,auto)", gap: 16 }}
        >
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className={f.span} style={{ ...baseCard, ...cardReveal(i) }}>
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 14,
                    background: t.accentTint,
                    color: t.accentTintText,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 18,
                  }}
                >
                  <Icon size={23} />
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>{f.title}</div>
                <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.55, color: t.textFaint, maxWidth: 360 }}>
                  {f.desc}
                </p>

                {f.chips && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 18 }}>
                    {f.chips.map((c) => (
                      <span
                        key={c}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "6px 12px",
                          borderRadius: 9999,
                          background: t.chipBg,
                          color: t.textMuted,
                        }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                {f.preview && (
                  <div style={{ marginTop: 18, borderRadius: 14, background: t.chipBg, padding: "4px 14px" }}>
                    {f.preview.map((row) => (
                      <div
                        key={row.label}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "9px 0",
                          borderBottom: `1px solid ${t.border}`,
                          fontSize: 12.5,
                        }}
                      >
                        <span style={{ color: t.textFaint }}>{row.label}</span>
                        <span style={{ fontWeight: 600 }}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------- PLATFORMS ---------- */}
      <div ref={platformsRef} id="platforms" style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 24px", scrollMarginTop: 24 }}>
        <div
          style={{
            borderRadius: 32,
            background: t.subtleBg,
            padding: "clamp(32px,5vw,52px)",
            display: "flex",
            flexWrap: "wrap",
            gap: 28,
            alignItems: "center",
            justifyContent: "space-between",
            ...reveal(revealed.platforms),
          }}
        >
          <div style={{ maxWidth: 360 }}>
            <h3
              style={{
                margin: 0,
                fontFamily: SERIF,
                fontWeight: 600,
                fontSize: "clamp(22px,2.8vw,29px)",
                letterSpacing: "-0.01em",
              }}
            >
              One product, every screen
            </h3>
            <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.55, color: t.textFaint }}>
              The native apps are thin shells around the same product — nothing
              gets left behind.
            </p>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.title}
                  className="hm-lift"
                  style={{ width: 184, borderRadius: 18, background: t.surface, boxShadow: t.cardShadow, padding: 18 }}
                >
                  <Icon size={23} color={t.accent} />
                  <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600 }}>{p.title}</div>
                  <div style={{ marginTop: 3, fontSize: 12.5, color: t.textFaint, lineHeight: 1.4 }}>{p.desc}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---------- CLOSING CTA ---------- */}
      <div ref={ctaRef} style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 100px", ...reveal(revealed.cta) }}>
        <div
          onMouseMove={(e) => onGlowMove("cta", e)}
          onMouseLeave={() => onGlowLeave("cta")}
          style={{
            borderRadius: 36,
            background: t.ctaBg,
            padding: "clamp(56px,9vw,96px) 24px",
            textAlign: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              bottom: -160,
              right: -80,
              width: 420,
              height: 420,
              borderRadius: 9999,
              background: t.ctaOrb,
              filter: "blur(80px)",
              animation: "hm-orb 10s ease-in-out infinite",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 300,
              height: 300,
              borderRadius: 9999,
              background: t.ctaGlowCursor,
              filter: "blur(55px)",
              opacity: glowOpacity(glow.cta),
              transform: `translate(${glow.cta.x}px,${glow.cta.y}px) translate(-50%,-50%)`,
              transition: "opacity .3s ease",
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative", zIndex: 1 }}>
            <h3
              style={{
                margin: 0,
                fontFamily: SERIF,
                fontWeight: 600,
                color: t.ctaText,
                fontSize: "clamp(30px,5vw,52px)",
                letterSpacing: "-0.02em",
              }}
            >
              Let the paperwork
              <br />
              write itself.
            </h3>
            <div style={{ marginTop: 32 }}>
              <Link
                href={GET_STARTED_HREF}
                onMouseMove={(e) => onMagnetMove("cta", e)}
                onMouseLeave={() => onMagnetLeave("cta")}
                onClick={(e) => onCtaClick("cta", GET_STARTED_HREF, e)}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  height: 52,
                  padding: "0 30px",
                  borderRadius: 9999,
                  background: t.ctaButtonBg,
                  color: t.ctaButtonText,
                  fontSize: 16,
                  fontWeight: 600,
                  ...magnetStyle(magnet.cta),
                }}
              >
                Get started
                <ArrowRight size={19} />
                {ripples
                  .filter((r) => r.key === "cta")
                  .map((r) => (
                    <span key={r.id} style={rippleStyle(r, t.accentSolid, 20)} />
                  ))}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- FOOTER ---------- */}
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "24px 24px 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          borderTop: `1px solid ${t.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: t.textFaint, fontSize: 13 }}>
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              background: t.accentSolid,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 700,
              fontSize: 10,
              fontFamily: SERIF,
            }}
          >
            C
          </span>
          © 2026 ContractorAI
        </div>
        <Link href={SIGN_IN_HREF} style={{ fontSize: 13, fontWeight: 600, color: t.textMuted }}>
          Sign in
        </Link>
      </div>
    </div>
  );
}

function rippleStyle(r: Ripple, color: string, size: number): CSSProperties {
  return {
    position: "absolute",
    left: r.x,
    top: r.y,
    width: size,
    height: size,
    margin: -size / 2,
    borderRadius: 9999,
    background: color,
    animation: `hm-ripple 650ms ${EASE_OUT} forwards`,
    pointerEvents: "none",
  };
}

function eyebrow(t: Tokens, marginBottom = 36): CSSProperties {
  return {
    fontSize: 12.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: t.textFaint,
    marginBottom,
  };
}
