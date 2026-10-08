import {
  issueKeyInput,
  keyListInput,
  revokeKeyInput,
} from "../domain/credentials";
import { AppError, parseInput, publicError } from "../domain/errors";
import type { CredentialService } from "../services/credential-service";
import { body } from "./router";

// Key administration for the hosted service. Callers must already have passed
// administrator authentication; this router only manages credentials.
export function createAdminRouter(
  credentials: CredentialService,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/admin/keys") {
        if (request.method === "GET") {
          const accountId = url.searchParams.get("accountId");
          return Response.json(
            credentials.list(
              parseInput(keyListInput, accountId === null ? {} : { accountId }),
            ),
          );
        }
        if (request.method === "POST")
          return Response.json(
            await credentials.issue(await body(request, issueKeyInput)),
            { status: 201 },
          );
        throw new AppError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
      }
      const revoke = /^\/admin\/keys\/([^/]+)\/revoke$/.exec(url.pathname);
      if (revoke) {
        if (request.method !== "POST")
          throw new AppError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        let keyId: string;
        try {
          keyId = decodeURIComponent(revoke[1] ?? "");
        } catch {
          throw new AppError("INVALID_REQUEST", "Malformed URL encoding.");
        }
        return Response.json(
          credentials.revoke(parseInput(revokeKeyInput, { keyId })),
        );
      }
      throw new AppError("NOT_FOUND", "Endpoint does not exist.", 404);
    } catch (error) {
      const failure = publicError(error);
      return Response.json(failure.toJSON(), { status: failure.status });
    }
  };
}
