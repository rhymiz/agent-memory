import type { Principal } from "../domain/credentials";
import { AppError, publicError } from "../domain/errors";
import { constantTimeEqual } from "../services/credential-service";

// The hosted service's edge after authentication. The OAuth provider (or a
// test composition) authenticates the bearer token and supplies the principal.
export interface ApiBindings {
  // Returns false when the credential has exceeded its request rate.
  admit(principal: Principal): Promise<boolean>;
  forward(principal: Principal, request: Request): Promise<Response>;
}

export interface AdminBindings {
  adminToken: string | undefined;
  administer(request: Request): Promise<Response>;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header === null ? null : /^Bearer ([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

// Copy first: responses returned across runtime boundaries can have immutable headers.
function secured(original: Response): Response {
  const response = new Response(original.body, original);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function failureResponse(error: unknown): Response {
  const failed = publicError(error);
  return secured(
    Response.json(failed.toJSON(), {
      status: failed.status,
      headers: failed.status === 401 ? { "WWW-Authenticate": "Bearer" } : {},
    }),
  );
}

// Browsers never need the API or admin routes; rejecting Origin closes
// cross-site use of credentials a browser might attach.
function rejectBrowsers(request: Request): void {
  if (request.headers.get("origin") !== null)
    throw new AppError(
      "FORBIDDEN",
      "Cross-origin requests are not allowed.",
      403,
    );
}

export function createApiGateway(
  bindings: ApiBindings,
): (request: Request, principal: Principal) => Promise<Response> {
  return async (request, principal) => {
    try {
      rejectBrowsers(request);
      if (!(await bindings.admit(principal)))
        throw new AppError(
          "RATE_LIMITED",
          "Request rate limit exceeded for this credential.",
          429,
        );
      return await bindings.forward(principal, request);
    } catch (error) {
      return failureResponse(error);
    }
  };
}

export function createAdminGateway(
  bindings: AdminBindings,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      rejectBrowsers(request);
      const token = bearerToken(request);
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
    } catch (error) {
      return failureResponse(error);
    }
  };
}
