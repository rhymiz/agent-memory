import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import * as c from "../src/domain/contracts";
import { apiKey, issuedKey, keyList } from "../src/domain/credentials";
import { errorResponse } from "../src/domain/errors";
import { toolError } from "./helpers";
import {
  adminToken,
  hostedFixture,
  type HostedFixture,
} from "./hosted-helpers";

let h: HostedFixture;
beforeEach(() => {
  h = hostedFixture();
});
afterEach(async () => {
  await h.close();
});

const json = (value: unknown) => JSON.stringify(value);
async function failure(response: Response) {
  return errorResponse.parse(await response.json()).error;
}
const remember = (projectId: string, content = "shared finding") =>
  json({ projectId, agentId: "agent-a", type: "fact", content });

describe("authentication", () => {
  test("rejects missing, malformed, unknown and tampered keys alike", async () => {
    const { token } = await h.issue("acme", {
      projects: "all",
      access: "write",
    });
    const [keyId] = token.split(".");
    for (const presented of [
      null,
      "not-a-key",
      `${keyId}.wrong-secret`,
      `key_unknown.${token.split(".")[1]}`,
      `${token}.extra`,
    ]) {
      const response = await h.request("/health", presented);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await failure(response)).code).toBe("UNAUTHORIZED");
    }
    expect((await h.request("/health", token)).status).toBe(200);
  });

  test("rejects revoked and expired keys", async () => {
    const revoked = await h.issue("acme", { projects: "all", access: "write" });
    expect((await h.request("/health", revoked.token)).status).toBe(200);
    h.credentials.revoke({ keyId: revoked.key.id });
    expect((await h.request("/health", revoked.token)).status).toBe(401);

    const expiring = await h.issue(
      "acme",
      { projects: "all", access: "read" },
      h.time + 1000,
    );
    expect((await h.request("/health", expiring.token)).status).toBe(200);
    h.advance(1000);
    expect((await h.request("/health", expiring.token)).status).toBe(401);
  });

  test("records last use at most once a minute", async () => {
    const { key, token } = await h.issue("acme", {
      projects: "all",
      access: "read",
    });
    const lastUsed = () =>
      h.credentials
        .list({ accountId: "acme" })
        .items.find((item) => item.id === key.id)?.lastUsedAt;
    expect(lastUsed()).toBeNull();
    await h.request("/health", token);
    const first = h.time;
    expect(lastUsed()).toBe(first);
    h.advance(59_999);
    await h.request("/health", token);
    expect(lastUsed()).toBe(first);
    h.advance(1);
    await h.request("/health", token);
    expect(lastUsed()).toBe(first + 60_000);
  });

  test("rejects browser origins and rate-limited keys", async () => {
    const { token } = await h.issue("acme", {
      projects: "all",
      access: "read",
    });
    const crossOrigin = await h.request("/health", token, {
      headers: { Origin: "https://attacker.example" },
    });
    expect(crossOrigin.status).toBe(403);
    h.rateLimit(true);
    const limited = await h.request("/health", token);
    expect(limited.status).toBe(429);
    expect((await failure(limited)).code).toBe("RATE_LIMITED");
  });
});

describe("administration", () => {
  test("requires the administrator token", async () => {
    const agent = await h.issue("acme", { projects: "all", access: "write" });
    for (const presented of [null, "wrong", agent.token]) {
      const response = await h.request("/admin/keys", presented);
      expect(response.status).toBe(401);
    }
  });

  test("issues, lists and revokes keys without exposing secrets", async () => {
    const created = await h.request("/admin/keys", adminToken, {
      method: "POST",
      body: json({
        accountId: "acme",
        name: "ci",
        grant: { projects: ["web"], access: "read" },
      }),
    });
    expect(created.status).toBe(201);
    const issued = issuedKey.parse(await created.json());
    expect((await h.request("/health", issued.token)).status).toBe(200);

    const listed = keyList.parse(
      await (await h.request("/admin/keys?accountId=acme", adminToken)).json(),
    );
    expect(listed.items.map((item) => item.id)).toEqual([issued.key.id]);
    const raw = JSON.stringify(listed);
    expect(raw).not.toContain(issued.token.split(".")[1]!);
    expect(raw).not.toContain("secretHash");

    const revoked = await h.request(
      `/admin/keys/${encodeURIComponent(issued.key.id)}/revoke`,
      adminToken,
      { method: "POST" },
    );
    expect(apiKey.parse(await revoked.json()).revokedAt).toBe(h.time);
    expect((await h.request("/health", issued.token)).status).toBe(401);

    const unknown = await h.request(
      "/admin/keys/key_missing/revoke",
      adminToken,
      {
        method: "POST",
      },
    );
    expect((await failure(unknown)).code).toBe("KEY_NOT_FOUND");
    const invalid = await h.request("/admin/keys", adminToken, {
      method: "POST",
      body: json({ accountId: "acme", name: "x", grant: { projects: [] } }),
    });
    expect((await failure(invalid)).code).toBe("INVALID_REQUEST");
  });
});

describe("project authorization over HTTP", () => {
  test("a write key creates projects on first write only within its grant", async () => {
    const { token } = await h.issue("acme", {
      projects: ["web"],
      access: "write",
    });
    const created = await h.request("/memories", token, {
      method: "POST",
      body: remember("web"),
    });
    expect(created.status).toBe(201);
    const outside = await h.request("/memories", token, {
      method: "POST",
      body: remember("billing"),
    });
    expect(outside.status).toBe(403);
    expect((await failure(outside)).code).toBe("FORBIDDEN");
    const read = await h.request(
      "/memories/search?projectId=billing&q=shared",
      token,
    );
    expect(read.status).toBe(403);
  });

  test("a read key reads but cannot write", async () => {
    const writer = await h.issue("acme", { projects: "all", access: "write" });
    const reader = await h.request("/admin/keys", adminToken, {
      method: "POST",
      body: json({
        accountId: "acme",
        name: "reader",
        grant: { projects: ["web"], access: "read" },
      }),
    });
    const { token } = issuedKey.parse(await reader.json());
    await h.request("/memories", writer.token, {
      method: "POST",
      body: remember("web"),
    });
    const found = await h.request(
      "/memories/search?projectId=web&q=shared",
      token,
    );
    expect(c.memoriesResult.parse(await found.json()).items).toHaveLength(1);
    for (const [path, init] of [
      ["/memories", { method: "POST", body: remember("web") }],
      [
        "/projects/web/context",
        {
          method: "PUT",
          body: json({ agentId: "a", expectedVersion: 0, content: "x" }),
        },
      ],
      [
        "/claims",
        {
          method: "POST",
          body: json({ projectId: "web", agentId: "a", resource: "file:a.ts" }),
        },
      ],
    ] as const) {
      const response = await h.request(path, token, init);
      expect(response.status).toBe(403);
    }
  });

  test("accounts are isolated even when project IDs match", async () => {
    const acme = await h.issue("acme", { projects: "all", access: "write" });
    const other = await h.issue("globex", { projects: "all", access: "write" });
    await h.request("/memories", acme.token, {
      method: "POST",
      body: remember("web", "acme secret plan"),
    });
    const search = await h.request(
      "/memories/search?projectId=web&q=secret",
      other.token,
    );
    expect(c.memoriesResult.parse(await search.json()).items).toEqual([]);
    const projects = await h.request("/projects", other.token);
    expect(c.projectPage.parse(await projects.json()).items).toEqual([]);
  });

  test("operator reads show only granted projects", async () => {
    const writer = await h.issue("acme", { projects: "all", access: "write" });
    for (const project of ["billing", "web"])
      await h.request("/memories", writer.token, {
        method: "POST",
        body: remember(project),
      });
    const limited = await h.issue("acme", {
      projects: ["web"],
      access: "read",
    });
    const projects = await h.request("/projects", limited.token);
    expect(c.projectPage.parse(await projects.json()).items).toEqual([
      { projectId: "web" },
    ]);
    expect((await h.request("/stats", limited.token)).status).toBe(403);
    expect(
      (await h.request("/stats?projectId=web", limited.token)).status,
    ).toBe(200);
    expect(
      (await h.request("/stats?projectId=billing", limited.token)).status,
    ).toBe(403);
    expect((await h.request("/stats", writer.token)).status).toBe(200);
  });

  test("claims outside the grant are indistinguishable from missing ones", async () => {
    const writer = await h.issue("acme", { projects: "all", access: "write" });
    const acquired = await h.request("/claims", writer.token, {
      method: "POST",
      body: json({ projectId: "billing", agentId: "a", resource: "file:a.ts" }),
    });
    const { claim } = c.claimGranted.parse(await acquired.json());
    const limited = await h.issue("acme", {
      projects: ["web"],
      access: "write",
    });
    const release = await h.request(`/claims/${claim.id}`, limited.token, {
      method: "DELETE",
      body: json({ agentId: "a" }),
    });
    expect((await failure(release)).code).toBe("CLAIM_NOT_FOUND");
    const renew = await h.request(`/claims/${claim.id}/renew`, limited.token, {
      method: "POST",
      body: json({ agentId: "a" }),
    });
    expect((await failure(renew)).code).toBe("CLAIM_NOT_FOUND");
  });
});

describe.each(["2026-07-28", "2025-06-18"])(
  "project authorization over MCP %s",
  (protocolVersion) => {
    async function connect(token: string) {
      const mcp = new Client(
        { name: "hosted-agent", version: "1.0.0" },
        {
          supportedProtocolVersions: [protocolVersion],
          versionNegotiation: {
            mode:
              protocolVersion === "2026-07-28"
                ? { pin: protocolVersion }
                : "legacy",
          },
        },
      );
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL("/mcp", h.baseUrl), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      return mcp;
    }

    test("tools enforce the key's projects and access level", async () => {
      const writer = await h.issue("acme", {
        projects: ["web"],
        access: "write",
      });
      const reader = await h.issue("acme", {
        projects: ["web"],
        access: "read",
      });
      const write = await connect(writer.token);
      const read = await connect(reader.token);
      try {
        const actor = { projectId: "web", agentId: "mcp-agent" };
        const stored = await write.callTool({
          name: "memory_remember",
          arguments: { ...actor, type: "fact", content: "granted write" },
        });
        expect(stored.isError).not.toBe(true);
        const outside = await write.callTool({
          name: "memory_remember",
          arguments: {
            ...actor,
            projectId: "billing",
            type: "fact",
            content: "outside grant",
          },
        });
        expect(toolError(outside).code).toBe("FORBIDDEN");
        const searched = await read.callTool({
          name: "memory_search",
          arguments: { projectId: "web", query: "granted" },
        });
        expect(searched.isError).not.toBe(true);
        const denied = await read.callTool({
          name: "decision_record",
          arguments: { ...actor, subject: "s", decision: "d" },
        });
        expect(toolError(denied).code).toBe("FORBIDDEN");
        const projects = await read.callTool({
          name: "projects_list",
          arguments: {},
        });
        expect(c.projectPage.parse(projects.structuredContent).items).toEqual([
          { projectId: "web" },
        ]);
      } finally {
        await write.close();
        await read.close();
      }
    });

    test("resources outside the grant return an error payload", async () => {
      const limited = await h.issue("acme", {
        projects: ["web"],
        access: "read",
      });
      const mcp = await connect(limited.token);
      try {
        const result = await mcp.readResource({
          uri: "memory://projects/billing/claims",
        });
        const [content] = result.contents;
        const text = content && "text" in content ? content.text : "";
        expect(errorResponse.parse(JSON.parse(text)).error.code).toBe(
          "FORBIDDEN",
        );
      } finally {
        await mcp.close();
      }
    });
  },
);
