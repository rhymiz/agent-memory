import type {
  ApiKey,
  IssueKeyInput,
  IssuedKey,
  KeyList,
  KeyListInput,
  Principal,
  RevokeKeyInput,
} from "../domain/credentials";
import { AppError } from "../domain/errors";
import { newId } from "../domain/ids";
import type { CredentialRepository } from "../repositories/credential-repository";
import type { UnitOfWork } from "../repositories/sqlite-store";
import type { Clock } from "./activity-service";

// Recording every use would write on every request; once a minute is enough
// to show whether a key is still in use.
const touchIntervalMs = 60_000;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256(value: string): Promise<string> {
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function secret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export class CredentialService {
  constructor(
    private readonly repository: CredentialRepository,
    private readonly transaction: UnitOfWork,
    private readonly now: Clock,
  ) {}

  async issue(input: IssueKeyInput): Promise<IssuedKey> {
    const now = this.now();
    if (input.expiresAt !== undefined && input.expiresAt <= now)
      throw new AppError(
        "INVALID_REQUEST",
        "expiresAt must be in the future.",
        400,
      );
    const value = secret();
    const hash = await sha256(value);
    const key: ApiKey = {
      id: newId("key"),
      accountId: input.accountId,
      name: input.name,
      grant: input.grant,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      lastUsedAt: null,
    };
    this.transaction.run(() => this.repository.insert(key, hash));
    return { key, token: `${key.id}.${value}` };
  }

  // Tokens are `<keyId>.<secret>`. Every invalid, revoked or expired token
  // resolves to null, so callers cannot tell the failures apart.
  async authenticate(token: string): Promise<Principal | null> {
    const [keyId, value, extra] = token.split(".");
    if (!keyId?.startsWith("key_") || !value || extra !== undefined)
      return null;
    const hash = await sha256(value);
    return this.transaction.run(() => {
      const stored = this.repository.get(keyId);
      const now = this.now();
      if (
        !stored ||
        !constantTimeEqual(stored.secretHash, hash) ||
        stored.key.revokedAt !== null ||
        (stored.key.expiresAt !== null && stored.key.expiresAt <= now)
      )
        return null;
      if (
        stored.key.lastUsedAt === null ||
        now - stored.key.lastUsedAt >= touchIntervalMs
      )
        this.repository.touch(keyId, now);
      return {
        accountId: stored.key.accountId,
        credentialId: keyId,
        grant: stored.key.grant,
      };
    });
  }

  list(input: KeyListInput): KeyList {
    return { items: this.repository.list(input.accountId) };
  }

  revoke(input: RevokeKeyInput): ApiKey {
    return this.transaction.run(() => {
      const stored = this.repository.get(input.keyId);
      if (!stored)
        throw new AppError("KEY_NOT_FOUND", "API key does not exist.", 404, {
          keyId: input.keyId,
        });
      // Revocation is idempotent; the first revocation time is kept.
      this.repository.revoke(input.keyId, this.now());
      const revoked = this.repository.get(input.keyId);
      if (!revoked) throw new Error("Revoked key disappeared");
      return revoked.key;
    });
  }
}
