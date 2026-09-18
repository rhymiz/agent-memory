import type { Page } from "./contracts";

// Callers fetch limit + 1 rows in ascending cursor order. Cursors survive deletion.
export function page<T>(
  rows: T[],
  limit: number,
  cursor: (item: T) => string,
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? cursor(last) : null,
  };
}
