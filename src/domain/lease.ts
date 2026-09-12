import type { LeaseSchedule } from "./contracts";

export function scheduleLease(expiresAt: number, ttlMs: number): LeaseSchedule {
  return { expiresAt, renewAfter: Math.max(0, expiresAt - ttlMs / 2) };
}
