import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { synthesizeSpeech } from "@/lib/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkRateLimit("tts", user.id, { limit: 30, windowSeconds: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: { text?: string };
  try {
    body = (await req.json()) as { text?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Empty text" }, { status: 400 });

  let result;
  try {
    result = await synthesizeSpeech(text);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TTS failed" },
      { status: 502 },
    );
  }
  // 501 → not configured; the client falls back to browser speech synthesis.
  if (!result) {
    return NextResponse.json({ error: "TTS not configured" }, { status: 501 });
  }

  return new Response(new Uint8Array(result.audio), {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "no-store",
    },
  });
}
