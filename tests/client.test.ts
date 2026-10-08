import { afterEach, beforeEach, expect, test } from "bun:test";
import { MemoryClient, MemoryClientError } from "../src/client/memory-client";
import { hostedFixture, type HostedFixture } from "./hosted-helpers";

let h: HostedFixture;
beforeEach(() => {
  h = hostedFixture();
});
afterEach(async () => {
  await h.close();
});

const actor = { projectId: "web", agentId: "client-agent" };

test("requires https for remote services", () => {
  expect(
    () => new MemoryClient({ ...actor, baseUrl: "http://memory.example.com/" }),
  ).toThrow("https");
  for (const baseUrl of [
    "https://memory.example.com/",
    "http://localhost:8787/",
    "http://127.0.0.1:8787/",
    "http://[::1]:8787/",
  ])
    expect(() => new MemoryClient({ ...actor, baseUrl })).not.toThrow();
});

test("sends the API key to the hosted service", async () => {
  const { token } = await h.issue("acme", {
    projects: ["web"],
    access: "write",
  });
  const client = new MemoryClient({
    ...actor,
    baseUrl: h.baseUrl,
    apiKey: token,
  });
  const memory = await client.remember({ type: "fact", content: "via client" });
  expect(memory.projectId).toBe("web");

  const anonymous = new MemoryClient({ ...actor, baseUrl: h.baseUrl });
  const error = await anonymous
    .remember({ type: "fact", content: "denied" })
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MemoryClientError);
  expect(error).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
});
