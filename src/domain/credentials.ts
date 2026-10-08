import { z } from "zod";
import { grant } from "./access";
import { identifier, timestamp } from "./contracts";

export const keyName = z.string().trim().min(1).max(128);
export const apiKey = z.strictObject({
  id: identifier,
  accountId: identifier,
  name: keyName,
  grant,
  createdAt: timestamp,
  expiresAt: timestamp.nullable(),
  revokedAt: timestamp.nullable(),
  lastUsedAt: timestamp.nullable(),
});
export const issueKeyInput = z.strictObject({
  accountId: identifier,
  name: keyName,
  grant,
  expiresAt: timestamp.optional(),
});
// The token is shown once at issue time; only its hash is stored.
export const issuedKey = z.strictObject({ key: apiKey, token: z.string() });
export const keyListInput = z.strictObject({
  accountId: identifier.optional(),
});
export const keyList = z.strictObject({ items: z.array(apiKey) });
export const revokeKeyInput = z.strictObject({ keyId: identifier });
export const principal = z.strictObject({
  accountId: identifier,
  keyId: identifier,
  grant,
});

export type ApiKey = z.infer<typeof apiKey>;
export type IssueKeyInput = z.infer<typeof issueKeyInput>;
export type IssuedKey = z.infer<typeof issuedKey>;
export type KeyListInput = z.infer<typeof keyListInput>;
export type KeyList = z.infer<typeof keyList>;
export type RevokeKeyInput = z.infer<typeof revokeKeyInput>;
export type Principal = z.infer<typeof principal>;
