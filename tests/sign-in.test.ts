import { beforeEach, expect, test } from "bun:test";
import type {
  AuthRequest,
  CompleteAuthorizationOptions,
} from "@cloudflare/workers-oauth-provider";
import {
  authorizePath,
  callbackPath,
  createSignIn,
  memberTokenProps,
  type AuthorizationFlow,
  type IdentityProvider,
} from "../src/api/sign-in";
import type { Member, VerifiedIdentity } from "../src/domain/members";

const origin = "https://memory.example.com";
const authRequest: AuthRequest = {
  responseType: "code",
  clientId: "client-1",
  redirectUri: "http://127.0.0.1:3000/callback",
  scope: ["memory:read", "memory:write"],
  state: "client-state",
  codeChallenge: "challenge",
  codeChallengeMethod: "S256",
  resource: origin,
};
const octocat: Member = {
  id: "mbr_1",
  accountId: "acme",
  provider: "github",
  subject: "1024",
  login: "octocat",
  grant: { projects: "all", access: "write" },
  createdAt: 1,
  revokedAt: null,
};

// Records how sign-in drives the OAuth provider, standing in for its helpers.
class RecordingFlow implements AuthorizationFlow {
  clientName = "Claude Code";
  approvedScope: string[] | undefined;
  upstreamData: unknown;
  completed: CompleteAuthorizationOptions | undefined;
  failParse = false;
  async parseAuthRequest(): Promise<AuthRequest> {
    if (this.failParse) throw new Error("Invalid redirect URI");
    return authRequest;
  }
  async describeConsent() {
    return {
      clientId: authRequest.clientId,
      clientName: this.clientName,
      redirectUri: authRequest.redirectUri,
      redirectHost: "127.0.0.1",
      redirectIsLoopback: true,
      scope: authRequest.scope,
    };
  }
  async beginConsent() {
    return {
      handle: "consent-handle",
      headers: new Headers({ "Set-Cookie": "bind=1" }),
    };
  }
  async approveConsent(
    _request: Request,
    handle: string,
    options?: { scope?: string[] },
  ) {
    if (handle !== "consent-handle") throw new Error("unbound handle");
    this.approvedScope = options?.scope;
    return {
      request: authRequest,
      headers: new Headers({ "Set-Cookie": "approved=1" }),
    };
  }
  async denyConsent() {
    return {
      request: authRequest,
      redirectTo: `${authRequest.redirectUri}?error=access_denied`,
      headers: new Headers(),
    };
  }
  async beginUpstream(
    _request: AuthRequest,
    options?: { data?: unknown; headers?: Headers },
  ) {
    this.upstreamData = options?.data;
    const headers = new Headers(options?.headers);
    headers.append("Set-Cookie", "upstream=1");
    return { state: "upstream-state", headers };
  }
  async finishUpstream<Data = unknown>() {
    // The provider returns the data saved by beginUpstream at the callback.
    const data: Data = Object.assign(Object.create(null), this.upstreamData);
    return { request: authRequest, data, headers: new Headers() };
  }
  async completeAuthorization(options: CompleteAuthorizationOptions) {
    this.completed = options;
    return { redirectTo: `${authRequest.redirectUri}?code=issued` };
  }
}

class RecordingGitHub implements IdentityProvider {
  identity: VerifiedIdentity = {
    provider: "github",
    subject: "1024",
    login: "octocat",
  };
  exchanged:
    { code: string; codeVerifier: string; redirectUri: string } | undefined;
  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }) {
    const url = new URL("https://github.example/authorize");
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("redirect_uri", input.redirectUri);
    return url.href;
  }
  async identify(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }) {
    this.exchanged = input;
    return this.identity;
  }
}

let flow: RecordingFlow;
let github: RecordingGitHub;
let members: Map<string, Member>;
let signIn: (request: Request) => Promise<Response | null>;
beforeEach(() => {
  flow = new RecordingFlow();
  github = new RecordingGitHub();
  members = new Map([["1024", octocat]]);
  signIn = createSignIn({
    flow,
    identity: github,
    member: async (identity) => members.get(identity.subject) ?? null,
  });
});

const consent = (fields: Record<string, string>) =>
  new Request(`${origin}${authorizePath}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

async function sha256url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return btoa(String.fromCharCode(...digest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

test("the consent page escapes client-supplied text and binds the browser", async () => {
  flow.clientName = `<script>alert("x")</script>`;
  const response = await signIn(
    new Request(`${origin}${authorizePath}?client_id=client-1`),
  );
  expect(response?.status).toBe(200);
  expect(response?.headers.get("Set-Cookie")).toBe("bind=1");
  expect(response?.headers.get("Content-Security-Policy")).toContain(
    "frame-ancestors 'none'",
  );
  const html = (await response?.text()) ?? "";
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain('value="consent-handle"');
  expect(html).toContain("an app on this computer");
  // The client asked for write, so write is preselected.
  expect(html).toContain('value="write" checked');
});

test("approval sends the person to GitHub with PKCE and the chosen scopes", async () => {
  const response = await signIn(
    consent({ handle: "consent-handle", decision: "approve", access: "read" }),
  );
  expect(response?.status).toBe(302);
  expect(flow.approvedScope).toEqual(["memory:read"]);
  const location = new URL(response?.headers.get("Location") ?? "");
  expect(location.searchParams.get("state")).toBe("upstream-state");
  expect(location.searchParams.get("redirect_uri")).toBe(
    `${origin}${callbackPath}`,
  );
  const data = flow.upstreamData;
  expect(data).toMatchObject({ scopes: ["memory:read"] });
  const verifier =
    typeof data === "object" && data !== null && "codeVerifier" in data
      ? String(data.codeVerifier)
      : "";
  expect(location.searchParams.get("code_challenge")).toBe(
    await sha256url(verifier),
  );
  expect(response?.headers.getSetCookie()).toEqual([
    "approved=1",
    "upstream=1",
  ]);
});

test("declining returns access_denied to the client", async () => {
  const response = await signIn(
    consent({ handle: "consent-handle", decision: "deny" }),
  );
  expect(response?.status).toBe(302);
  expect(response?.headers.get("Location")).toContain("error=access_denied");
  expect(flow.approvedScope).toBeUndefined();
});

test("a member's callback completes authorization with grant-reference props", async () => {
  await signIn(
    consent({ handle: "consent-handle", decision: "approve", access: "write" }),
  );
  const response = await signIn(
    new Request(`${origin}${callbackPath}?code=gh-code&state=upstream-state`),
  );
  expect(response?.status).toBe(302);
  expect(response?.headers.get("Location")).toContain("code=issued");
  expect(github.exchanged?.code).toBe("gh-code");
  expect(github.exchanged?.redirectUri).toBe(`${origin}${callbackPath}`);
  expect(flow.completed?.userId).toBe("mbr_1");
  expect(flow.completed?.scope).toEqual(["memory:read", "memory:write"]);
  expect(memberTokenProps.parse(flow.completed?.props)).toEqual({
    kind: "member",
    memberId: "mbr_1",
    scopes: ["memory:read", "memory:write"],
  });
});

test("non-members and cancelled sign-ins never complete authorization", async () => {
  await signIn(
    consent({ handle: "consent-handle", decision: "approve", access: "read" }),
  );
  github.identity = { provider: "github", subject: "2048", login: "stranger" };
  const outsider = await signIn(
    new Request(`${origin}${callbackPath}?code=gh-code&state=upstream-state`),
  );
  expect(outsider?.status).toBe(403);
  expect(await outsider?.text()).toContain("@stranger is not a member");
  const cancelled = await signIn(
    new Request(
      `${origin}${callbackPath}?error=access_denied&state=upstream-state`,
    ),
  );
  expect(cancelled?.status).toBe(400);
  expect(flow.completed).toBeUndefined();
});

test("invalid requests and forms fail without detail; other paths are not handled", async () => {
  flow.failParse = true;
  const invalid = await signIn(new Request(`${origin}${authorizePath}`));
  expect(invalid?.status).toBe(400);
  expect(await invalid?.text()).not.toContain("Invalid redirect URI");
  const incomplete = await signIn(consent({ decision: "approve" }));
  expect(incomplete?.status).toBe(400);
  const stale = await signIn(
    consent({ handle: "other", decision: "approve", access: "read" }),
  );
  expect(stale?.status).toBe(400);
  expect(await signIn(new Request(`${origin}/elsewhere`))).toBeNull();
});
