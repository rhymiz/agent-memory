import { grantForScopes } from "../domain/access";
import type { Principal } from "../domain/credentials";
import { AppError } from "../domain/errors";
import { newId } from "../domain/ids";
import type {
  AddMemberInput,
  Member,
  MemberList,
  MemberListInput,
  RevokeMemberInput,
  VerifiedIdentity,
} from "../domain/members";
import type { MemberRepository } from "../repositories/member-repository";
import type { UnitOfWork } from "../repositories/sqlite-store";
import type { Clock } from "./activity-service";

export class MemberService {
  constructor(
    private readonly repository: MemberRepository,
    private readonly transaction: UnitOfWork,
    private readonly now: Clock,
  ) {}

  add(input: AddMemberInput): Member {
    return this.transaction.run(() => {
      const existing = this.repository.active(input.provider, input.subject);
      if (existing)
        throw new AppError(
          "MEMBER_CONFLICT",
          "This identity is already an active member. Revoke it before adding it again.",
          409,
          { memberId: existing.id, accountId: existing.accountId },
        );
      const added: Member = {
        ...input,
        id: newId("mbr"),
        createdAt: this.now(),
        revokedAt: null,
      };
      this.repository.insert(added);
      return added;
    });
  }

  list(input: MemberListInput): MemberList {
    return { items: this.repository.list(input.accountId) };
  }

  revoke(input: RevokeMemberInput): Member {
    return this.transaction.run(() => {
      if (!this.repository.get(input.memberId))
        throw new AppError("MEMBER_NOT_FOUND", "Member does not exist.", 404, {
          memberId: input.memberId,
        });
      // Revocation is idempotent; the first revocation time is kept.
      this.repository.revoke(input.memberId, this.now());
      const revoked = this.repository.get(input.memberId);
      if (!revoked) throw new Error("Revoked member disappeared");
      return revoked;
    });
  }

  // The active membership for an identity a provider verified, or null.
  signIn(identity: VerifiedIdentity): Member | null {
    return this.repository.active(identity.provider, identity.subject);
  }

  // The caller behind an OAuth token, read on every request so revocation
  // applies immediately and scopes can only narrow the member's grant.
  principal(memberId: string, scopes: readonly string[]): Principal | null {
    const current = this.repository.get(memberId);
    if (!current || current.revokedAt !== null) return null;
    return {
      accountId: current.accountId,
      credentialId: current.id,
      grant: grantForScopes(current.grant, scopes),
    };
  }
}
