import Anthropic from "@anthropic-ai/sdk";

declare global {
  var __anthropic: Anthropic | undefined;
}

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!global.__anthropic) {
    global.__anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 3,
      // Chat routes stream for up to maxDuration 300s; keep the client timeout
      // comfortably above that so the SDK never cuts a long turn short.
      timeout: 10 * 60 * 1000,
    });
  }
  return global.__anthropic;
}
