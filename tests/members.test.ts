import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { readScopes, writeScopes } from "../src/domain/access";
import * as c from "../src/domain/contracts";
import { errorResponse } from "../src/domain/errors";
import {
  member,
  memberList,
  type VerifiedIdentity,
} from "../src/domain/members";
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
const remember = (projectId: string) =>
  json({ projectId, agentId: "agent", type: "fact", content: "member note" });
async function code(response: Response) {
  return errorResponse.parse(await response.json()).error.code;
}

test("administrators add, list and revoke members", async () => {
  const added = await h.request("/admin/members", adminToken, {
    method: "POST",
    body: json({
      accountId: "acme",
      provider: "github",
      subject: "1024",
      login: "octocat",
      grant: { projects: ["web"], access: "write" },
    }),
  });
  expect(added.status).toBe(201);
  const created = member.parse(await added.json());
  expect(created).toMatchObject({ accountId: "acme", revokedAt: null });

  const duplicate = await h.request("/admin/members", adminToken, {
    method: "POST",
    body: json({
      accountId: "globex",
      provider: "github",
      subject: "1024",
      login: "octocat",
      grant: { projects: "all", access: "read" },
    }),
  });
  expect(duplicate.status).toBe(409);
  expect(await code(duplicate)).toBe("MEMBER_CONFLICT");

  const listed = memberList.parse(
    await (await h.request("/admin/members?accountId=acme", adminToken)).json(),
  );
  expect(listed.items.map((item) => item.id)).toEqual([created.id]);

  const revoked = await h.request(
    `/admin/members/${created.id}/revoke`,
    adminToken,
    { method: "POST" },
  );
  expect(member.parse(await revoked.json()).revokedAt).toBe(h.time);
  // A revoked identity can be added again, for example to another account.
  expect(
    (
      await h.request("/admin/members", adminToken, {
        method: "POST",
        body: json({
          accountId: "globex",
          provider: "github",
          subject: "1024",
          login: "octocat",
          grant: { projects: "all", access: "read" },
        }),
      })
    ).status,
  ).toBe(201);
  const missing = await h.request(
    "/admin/members/mbr_missing/revoke",
    adminToken,
    {
      method: "POST",
    },
  );
  expect(await code(missing)).toBe("MEMBER_NOT_FOUND");
  const unauthenticated = await h.request("/admin/members", null);
  expect(unauthenticated.status).toBe(401);
});

test("sign-in resolves only active members by provider subject", () => {
  const added = h.addMember("acme", "octocat", "1024", {
    projects: "all",
    access: "write",
  });
  const identity: VerifiedIdentity = {
    provider: "github",
    subject: "1024",
    login: "renamed",
  };
  expect(h.members.signIn(identity)?.id).toBe(added.id);
  expect(h.members.signIn({ ...identity, subject: "2048" })).toBeNull();
  h.members.revoke({ memberId: added.id });
  expect(h.members.signIn(identity)).toBeNull();
});

test("approved scopes narrow a member's grant but never widen it", async () => {
  const writer = h.addMember("acme", "writer", "1", {
    projects: ["web"],
    access: "write",
  });
  const reader = h.addMember("acme", "reader", "2", {
    projects: ["web"],
    access: "read",
  });
  const writeToken = h.signInToken(writer.id, writeScopes);
  const readOnlyToken = h.signInToken(writer.id, readScopes);
  const readerWithWriteScope = h.signInToken(reader.id, writeScopes);

  const post = (token: string, projectId = "web") =>
    h.request("/memories", token, {
      method: "POST",
      body: remember(projectId),
    });
  expect((await post(writeToken)).status).toBe(201);
  expect((await post(writeToken, "billing")).status).toBe(403);
  expect((await post(readOnlyToken)).status).toBe(403);
  expect((await post(readerWithWriteScope)).status).toBe(403);
  const read = await h.request(
    "/memories/search?projectId=web&q=member",
    readOnlyToken,
  );
  expect(c.memoriesResult.parse(await read.json()).items).toHaveLength(1);
});

test("revoking a member rejects its existing tokens on the next request", async () => {
  const added = h.addMember("acme", "octocat", "1024", {
    projects: "all",
    access: "write",
  });
  const token = h.signInToken(added.id, writeScopes);
  expect((await h.request("/health", token)).status).toBe(200);
  h.members.revoke({ memberId: added.id });
  const rejected = await h.request("/health", token);
  expect(rejected.status).toBe(401);
  expect(await code(rejected)).toBe("UNAUTHORIZED");
});

test("members use MCP with the same project checks", async () => {
  const added = h.addMember("acme", "octocat", "1024", {
    projects: ["web"],
    access: "write",
  });
  const mcp = new Client({ name: "member-agent", version: "1.0.0" });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", h.baseUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${h.signInToken(added.id, readScopes)}`,
        },
      },
    }),
  );
  try {
    const denied = await mcp.callTool({
      name: "memory_remember",
      arguments: {
        projectId: "web",
        agentId: "member-agent",
        type: "fact",
        content: "needs write scope",
      },
    });
    expect(toolError(denied).code).toBe("FORBIDDEN");
    const listed = await mcp.callTool({ name: "projects_list", arguments: {} });
    expect(listed.isError).not.toBe(true);
  } finally {
    await mcp.close();
  }
});
