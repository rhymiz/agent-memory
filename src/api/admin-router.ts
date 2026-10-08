import {
  issueKeyInput,
  keyListInput,
  revokeKeyInput,
} from "../domain/credentials";
import { AppError, parseInput, publicError } from "../domain/errors";
import {
  addMemberInput,
  memberListInput,
  revokeMemberInput,
} from "../domain/members";
import type { CredentialService } from "../services/credential-service";
import type { MemberService } from "../services/member-service";
import { body } from "./router";

function pathId(value: string | undefined): string {
  try {
    return decodeURIComponent(value ?? "");
  } catch {
    throw new AppError("INVALID_REQUEST", "Malformed URL encoding.");
  }
}

const methodNotAllowed = () =>
  new AppError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);

// Key and member administration for the hosted service. Callers must already
// have passed administrator authentication; this router only manages credentials.
export function createAdminRouter(
  credentials: CredentialService,
  members: MemberService,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url);
      const accountId = url.searchParams.get("accountId");
      const listFilter = accountId === null ? {} : { accountId };
      if (url.pathname === "/admin/keys") {
        if (request.method === "GET")
          return Response.json(
            credentials.list(parseInput(keyListInput, listFilter)),
          );
        if (request.method === "POST")
          return Response.json(
            await credentials.issue(await body(request, issueKeyInput)),
            { status: 201 },
          );
        throw methodNotAllowed();
      }
      if (url.pathname === "/admin/members") {
        if (request.method === "GET")
          return Response.json(
            members.list(parseInput(memberListInput, listFilter)),
          );
        if (request.method === "POST")
          return Response.json(
            members.add(await body(request, addMemberInput)),
            { status: 201 },
          );
        throw methodNotAllowed();
      }
      const revokeKey = /^\/admin\/keys\/([^/]+)\/revoke$/.exec(url.pathname);
      if (revokeKey) {
        if (request.method !== "POST") throw methodNotAllowed();
        return Response.json(
          credentials.revoke(
            parseInput(revokeKeyInput, { keyId: pathId(revokeKey[1]) }),
          ),
        );
      }
      const revokeMember = /^\/admin\/members\/([^/]+)\/revoke$/.exec(
        url.pathname,
      );
      if (revokeMember) {
        if (request.method !== "POST") throw methodNotAllowed();
        return Response.json(
          members.revoke(
            parseInput(revokeMemberInput, {
              memberId: pathId(revokeMember[1]),
            }),
          ),
        );
      }
      throw new AppError("NOT_FOUND", "Endpoint does not exist.", 404);
    } catch (error) {
      const failure = publicError(error);
      return Response.json(failure.toJSON(), { status: failure.status });
    }
  };
}
