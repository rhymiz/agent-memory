import type { BoundedCollection, TextExcerpt } from "./contracts";

const encoder = new TextEncoder();

export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

// Excerpts remain verbatim. Prefer a query term; semantic-only hits use the lead.
export function excerptText(
  text: string,
  query: string,
  characters: number,
): TextExcerpt {
  if (text.length <= characters) return { text, truncated: false };
  const terms = [...new Set(query.match(/[\p{L}\p{N}_]+/gu) ?? [])].sort(
    (a, b) => b.length - a.length,
  );
  let matchAt = 0;
  for (const term of terms) {
    const match = new RegExp(term, "iu").exec(text);
    if (match) {
      matchAt = match.index;
      break;
    }
  }
  let start = Math.max(
    0,
    Math.min(matchAt - Math.floor(characters / 4), text.length - characters),
  );
  let end = Math.min(text.length, start + characters);
  // UTF-16 boundaries must not split a surrogate pair.
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(text[start]!)) start++;
  if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end]!)) end--;
  return { text: text.slice(start, Math.max(start, end)), truncated: true };
}

export function projectExcerpt<T>(
  text: string,
  query: string,
  maxBytes: number,
  project: (excerpt: TextExcerpt) => T,
): T | undefined {
  let low = 0;
  let high = Math.min(text.length, 800);
  let best: T | undefined;
  // Each candidate is measured after JSON escaping and UTF-8 encoding.
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    const candidate = project(excerptText(text, query, size));
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
