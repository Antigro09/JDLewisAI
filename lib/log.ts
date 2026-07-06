/**
 * Minimal structured logger for server code. Emits one JSON line per event so
 * Vercel's log drain (or any collector) can filter/aggregate without parsing
 * prose. Use instead of bare console.* in catch blocks and background paths —
 * a swallowed error should at least leave a searchable trace.
 */

type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields?: LogFields) {
  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Normalize an unknown thrown value into loggable fields. */
export function errorFields(err: unknown): LogFields {
  if (err instanceof Error) {
    return { error: err.message, errorName: err.name };
  }
  return { error: String(err) };
}

export const log = {
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, err?: unknown, fields?: LogFields) =>
    emit("error", event, { ...(err !== undefined ? errorFields(err) : {}), ...fields }),
};
