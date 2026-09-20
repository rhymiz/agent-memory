import type { BoundedCollection, TextExcerpt } from "./contracts";

const encoder = new TextEncoder();

export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

// Keep the lead: a matching phrase can depend on an earlier date or condition.
export function excerptText(text: string, characters: number): TextExcerpt {
  if (text.length <= characters) return { text, truncated: false };
  let end = Math.max(0, characters);
  // UTF-16 boundaries must not split a surrogate pair.
  if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end]!)) end--;
  const prefix = text.slice(0, end);
  // Prefer a complete sentence or line when one fits; long leads still truncate.
  let boundary = 0;
  for (const match of text.matchAll(/[.!?](?=\s|$)|\n/gu)) {
    const next = match.index + match[0].length;
    if (next > end) break;
    boundary = next;
  }
  return { text: prefix.slice(0, boundary || end), truncated: true };
}

export function projectExcerpt<T>(
  text: string,
  maxBytes: number,
  project: (excerpt: TextExcerpt) => T,
): T | undefined {
  let low = 0;
  let high = Math.min(text.length, 800);
  let best: T | undefined;
  // Each candidate is measured after JSON escaping and UTF-8 encoding.
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    const candidate = project(excerptText(text, size));
    if (jsonBytes(candidate) <= maxBytes) {
      best = candidate;
      low = size + 1;
    } else high = size - 1;
  }
  return best;
}

export function projectCollection<S, T>(
  source: readonly S[],
  limit: number,
  maxBytes: number,
  project: (item: S, maxBytes: number) => T | undefined,
): BoundedCollection<T> {
  const result: BoundedCollection<T> = { items: [], hasMore: false };
  for (const item of source.slice(0, limit)) {
    const available =
      maxBytes - jsonBytes(result) - (result.items.length ? 1 : 0);
    const candidate = project(item, available);
    if (candidate === undefined) break;
    result.items.push(candidate);
  }
  result.hasMore = result.items.length < source.length;
  return result;
}
