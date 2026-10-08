import { z } from "zod";
import { grant } from "./access";
import { identifier, timestamp } from "./contracts";

export const identityProvider = z.enum(["github"]);
// The provider's stable account ID (GitHub's numeric user ID), not a renamable login.
export const identitySubject = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const identityLogin = z.string().trim().min(1).max(100);

// A person allowed to sign in, with the grant their OAuth tokens can use.
export const member = z.strictObject({
  id: identifier,
  accountId: identifier,
  provider: identityProvider,
  subject: identitySubject,
  login: identityLogin,
  grant,
  createdAt: timestamp,
  revokedAt: timestamp.nullable(),
});
export const addMemberInput = z.strictObject({
  accountId: identifier,
  provider: identityProvider,
  subject: identitySubject,
  login: identityLogin,
  grant,
});
export const memberListInput = z.strictObject({
  accountId: identifier.optional(),
});
export const memberList = z.strictObject({ items: z.array(member) });
export const revokeMemberInput = z.strictObject({ memberId: identifier });
// The identity an upstream provider verified at sign-in.
export const verifiedIdentity = z.strictObject({
  provider: identityProvider,
  subject: identitySubject,
  login: identityLogin,
});

export type Member = z.infer<typeof member>;
export type AddMemberInput = z.infer<typeof addMemberInput>;
export type MemberListInput = z.infer<typeof memberListInput>;
export type MemberList = z.infer<typeof memberList>;
export type RevokeMemberInput = z.infer<typeof revokeMemberInput>;
export type VerifiedIdentity = z.infer<typeof verifiedIdentity>;
