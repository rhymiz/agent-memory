import { z } from "zod";
import type { IdentityProvider } from "../api/sign-in";
import type { VerifiedIdentity } from "../domain/members";

const tokenResponse = z.union([
  z.object({ access_token: z.string().min(1), token_type: z.string() }),
  z.object({ error: z.string(), error_description: z.string().optional() }),
]);
const userResponse = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
});

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface GitHubOAuthApp {
  clientId: string;
  clientSecret: string;
}

// GitHub OAuth app sign-in with PKCE. No scopes are requested: an empty scope
// list still allows reading the signed-in user's public profile.
export class GitHubIdentityProvider implements IdentityProvider {
  constructor(
    private readonly app: GitHubOAuthApp,
    // Wrapped so Workers never invokes fetch with a foreign `this`.
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {}

  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.app.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("allow_signup", "false");
    return url.href;
  }

  async identify(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<VerifiedIdentity> {
    const exchanged = tokenResponse.parse(
      await (
        await this.fetcher("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: this.app.clientId,
            client_secret: this.app.clientSecret,
            code: input.code,
            redirect_uri: input.redirectUri,
            code_verifier: input.codeVerifier,
          }),
        })
      ).json(),
    );
    if ("error" in exchanged)
      throw new Error(`GitHub token exchange failed: ${exchanged.error}`);
    const response = await this.fetcher("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${exchanged.access_token}`,
        "User-Agent": "agent-memory",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok)
      throw new Error(`GitHub user lookup failed with HTTP ${response.status}`);
    const user = userResponse.parse(await response.json());
    return { provider: "github", subject: String(user.id), login: user.login };
  }
}
