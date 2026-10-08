import type {
  AuthRequest,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import {
  oauthScope,
  readScopes,
  writeScopes,
  type OAuthScope,
} from "../domain/access";
import type { Member, VerifiedIdentity } from "../domain/members";

// The OAuth provider operations sign-in uses; env.OAUTH_PROVIDER satisfies it.
export type AuthorizationFlow = Pick<
  OAuthHelpers,
  | "parseAuthRequest"
  | "describeConsent"
  | "beginConsent"
  | "approveConsent"
  | "denyConsent"
  | "beginUpstream"
  | "finishUpstream"
  | "completeAuthorization"
>;

// An upstream identity provider that verifies who is signing in.
export interface IdentityProvider {
  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  identify(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<VerifiedIdentity>;
}

export interface SignInBindings {
  flow: AuthorizationFlow;
  identity: IdentityProvider;
  // The active membership for a verified identity, or null.
  member(identity: VerifiedIdentity): Promise<Member | null>;
}

export const authorizePath = "/authorize";
export const callbackPath = "/oauth/github/callback";

// Props stored with each OAuth grant; the member's grant is re-read per request.
export const memberTokenProps = z.strictObject({
  kind: z.literal("member"),
  memberId: z.string().min(1),
  scopes: z.array(oauthScope).min(1),
});
export type MemberTokenProps = z.infer<typeof memberTokenProps>;

const upstreamData = z.strictObject({
  codeVerifier: z.string().min(43),
  scopes: z.array(oauthScope).min(1),
});

const consentForm = z.strictObject({
  handle: z.string().min(1),
  decision: z.enum(["approve", "deny"]),
  access: z.enum(["read", "write"]).default("read"),
});

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const verifier = base64url(random);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

const pageSecurity = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function page(
  title: string,
  body: string,
  status = 200,
  headers?: Headers,
): Response {
  const response = new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1f2328}h1{font-size:1.4rem}.note{color:#59636e}.warn{color:#9a6700}label{display:block;margin:.4rem 0}button{font:inherit;padding:.4rem 1rem;margin-right:.5rem}</style></head><body><h1>${escape(title)}</h1>${body}</body></html>`,
    { status, headers },
  );
  for (const [name, value] of Object.entries(pageSecurity))
    response.headers.set(name, value);
  return response;
}

function failure(message: string, status = 400): Response {
  return page("Sign-in failed", `<p>${escape(message)}</p>`, status);
}

function redirect(location: string, headers: Headers): Response {
  const response = new Response(null, { status: 302, headers });
  response.headers.set("Location", location);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function consentPage(
  flow: AuthorizationFlow,
  request: AuthRequest,
): Promise<Response> {
  const consent = await flow.describeConsent(request);
  const transaction = await flow.beginConsent(request);
  const wantsWrite = consent.scope.includes("memory:write");
  const client = consent.clientDomain
    ? `${escape(consent.clientName)} (${escape(consent.clientDomain)})`
    : `${escape(consent.clientName)} <span class="note">(name not verified)</span>`;
  const loopback = consent.redirectIsLoopback
    ? `<p class="warn">The redirect goes to an app on this computer. Any local program could receive the result; continue only if you started this sign-in.</p>`
    : "";
  return page(
    "Allow access to Agent Memory?",
    `<p>${client} wants to use Agent Memory as you.</p>
<p>After you sign in with GitHub, it will be sent to <strong>${escape(consent.redirectHost)}</strong>.</p>${loopback}
<form method="post" action="${authorizePath}">
<input type="hidden" name="handle" value="${escape(transaction.handle)}">
<label><input type="radio" name="access" value="read"${wantsWrite ? "" : " checked"}> Read memories, context and claims</label>
<label><input type="radio" name="access" value="write"${wantsWrite ? " checked" : ""}> Read and write</label>
<p class="note">Access never exceeds what an administrator granted your GitHub account.</p>
<button type="submit" name="decision" value="approve">Continue with GitHub</button>
<button type="submit" name="decision" value="deny">Cancel</button>
</form>`,
    200,
    transaction.headers,
  );
}

// Interactive OAuth authorization for people: consent, GitHub sign-in, then a
// grant for an active member. Returns null for paths it does not own.
export function createSignIn(
  bindings: SignInBindings,
): (request: Request) => Promise<Response | null> {
  const { flow, identity } = bindings;
  return async (request) => {
    const url = new URL(request.url);
    const redirectUri = `${url.origin}${callbackPath}`;
    try {
      if (url.pathname === authorizePath && request.method === "GET")
        return await consentPage(flow, await flow.parseAuthRequest(request));
      if (url.pathname === authorizePath && request.method === "POST") {
        const parsed = consentForm.safeParse(
          Object.fromEntries(await request.formData()),
        );
        if (!parsed.success) return failure("The consent form was incomplete.");
        const form = parsed.data;
        if (form.decision === "deny") {
          const denied = await flow.denyConsent(request, form.handle);
          return redirect(denied.redirectTo, denied.headers);
        }
        const scopes: OAuthScope[] =
          form.access === "write" ? writeScopes : readScopes;
        const approved = await flow.approveConsent(request, form.handle, {
          scope: scopes,
        });
        const { verifier, challenge } = await pkce();
        const upstream = await flow.beginUpstream(approved.request, {
          data: { codeVerifier: verifier, scopes },
          headers: approved.headers,
        });
        return redirect(
          identity.authorizationUrl({
            state: upstream.state,
            codeChallenge: challenge,
            redirectUri,
          }),
          upstream.headers,
        );
      }
      if (url.pathname === callbackPath && request.method === "GET") {
        const resumed = await flow.finishUpstream(request);
        const code = url.searchParams.get("code");
        if (code === null)
          return failure("GitHub sign-in was cancelled or did not complete.");
        const data = upstreamData.parse(resumed.data);
        const verified = await identity.identify({
          code,
          codeVerifier: data.codeVerifier,
          redirectUri,
        });
        const member = await bindings.member(verified);
        if (!member)
          return failure(
            `The GitHub account @${verified.login} is not a member of this Agent Memory service. Ask an administrator to add it.`,
            403,
          );
        const props: MemberTokenProps = {
          kind: "member",
          memberId: member.id,
          scopes: data.scopes,
        };
        const completed = await flow.completeAuthorization({
          request: resumed.request,
          userId: member.id,
          metadata: { login: member.login, accountId: member.accountId },
          scope: data.scopes,
          props,
        });
        return redirect(completed.redirectTo, resumed.headers);
      }
      return null;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "warn",
          event: "sign_in.failed",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );
      return failure(
        "This sign-in request is invalid or has expired. Start again from your agent.",
      );
    }
  };
}
