import type { Principal } from "../domain/credentials";
import { AppError, publicError } from "../domain/errors";
import { constantTimeEqual } from "../services/credential-service";

// The hosted service's public edge: authenticates every request, then hands it
// to the caller's account. The runtime supplies storage and routing.
export interface GatewayBindings {
  adminToken: string | undefined;
  // Resolves a presented API key, or null when it is not valid.
  authenticate(token: string): Promise<Principal | null>;
  // Returns false when the key has exceeded its request rate.
  admit(principal: Principal): Promise<boolean>;
  administer(request: Request): Promise<Response>;
  forward(principal: Principal, request: Request): Promise<Response>;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header === null ? null : /^Bearer ([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

function failure(error: unknown, headers: Record<string, string> = {}) {
  const failed = publicError(error);
  return secured(
    Response.json(failed.toJSON(), { status: failed.status, headers }),
  );
}

// Copy first: responses returned across runtime boundaries can have immutable headers.
function secured(original: Response): Response {
  const response = new Response(original.body, original);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

const unauthorized = () =>
  new AppError("UNAUTHORIZED", "A valid API key is required.", 401);

export function createGateway(
  bindings: GatewayBindings,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      // Browsers never need this API; rejecting Origin closes cross-site use of
      // credentials a browser might attach.
      if (request.headers.get("origin") !== null)
        throw new AppError(
          "FORBIDDEN",
          "Cross-origin requests are not allowed.",
          403,
        );
      const token = bearer(request);
      if (new URL(request.url).pathname.startsWith("/admin/")) {
        if (
          !bindings.adminToken ||
          token === null ||
          !constantTimeEqual(token, bindings.adminToken)
        )
          throw new AppError(
            "UNAUTHORIZED",
            "Administrator authentication is required.",
            401,
          );
        return secured(await bindings.administer(request));
      }
      if (token === null) throw unauthorized();
      const principal = await bindings.authenticate(token);
      if (principal === null) throw unauthorized();
      if (!(await bindings.admit(principal)))
        throw new AppError(
          "RATE_LIMITED",
          "Request rate limit exceeded for this API key.",
          429,
        );
      return await bindings.forward(principal, request);
    } catch (error) {
      return failure(
        error,
        error instanceof AppError && error.status === 401
          ? { "WWW-Authenticate": "Bearer" }
          : {},
      );
    }
  };
}
