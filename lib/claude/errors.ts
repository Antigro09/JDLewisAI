import Anthropic from "@anthropic-ai/sdk";

export type ClassifiedError = { message: string; retryable?: boolean };

/**
 * Map an exception from a model call to a user-safe error event. Returns null
 * when the client aborted the request — no error should be shown at all.
 * Never passes raw error internals through; callers log the original error
 * server-side before emitting the classified message.
 */
export function classifyModelError(err: unknown): ClassifiedError | null {
  if (err instanceof Anthropic.APIUserAbortError) return null;
  if (err instanceof Error && err.name === "AbortError") return null;
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      message:
        "Could not reach the AI service — please try again in a moment.",
      retryable: true,
    };
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) {
      return {
        message:
          "The AI service is not configured correctly — contact your administrator.",
      };
    }
    if (
      err.status === 429 ||
      err.status === 529 ||
      (typeof err.status === "number" && err.status >= 500)
    ) {
      return {
        message:
          "The AI service is briefly overloaded — please try again in a moment.",
        retryable: true,
      };
    }
    return { message: "The AI request failed — please try again." };
  }
  return { message: "Something went wrong while generating the response." };
}
