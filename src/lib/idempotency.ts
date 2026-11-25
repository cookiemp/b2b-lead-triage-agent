import { createHash } from "node:crypto";

export const DEFAULT_IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

export interface IdempotencyKeyOptions {
  readonly nowMs?: number;
  readonly windowMs?: number;
  readonly nonce?: string;
}

/**
 * Generates a time-windowed SHA-256 idempotency key from normalized email + message
 * (+ optional client nonce for interactive demo presets).
 *
 * - Webhook / n8n callers omit `nonce`: retries within the 10-minute window deduplicate cleanly,
 *   while legitimate follow-ups after the window expire run fresh.
 * - Demo presets pass a per-click `idempotency_nonce`: every visitor click runs live, while
 *   accidental double-clicks on Submit reuse the same nonce and deduplicate cleanly.
 */
export function computeIdempotencyKey(
  email: string,
  message: string,
  options: IdempotencyKeyOptions = {},
): string {
  const {
    nowMs = Date.now(),
    windowMs = DEFAULT_IDEMPOTENCY_WINDOW_MS,
    nonce = "",
  } = options;

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedMessage = message.trim().replace(/\s+/g, " ");
  const normalizedNonce = nonce.trim();
  const timeBucket = Math.floor(nowMs / windowMs);

  return createHash("sha256")
    .update(
      `${normalizedEmail}\0${normalizedMessage}\0${timeBucket}\0${normalizedNonce}`,
      "utf8",
    )
    .digest("hex");
}
