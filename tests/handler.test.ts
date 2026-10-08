import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHttpHandler, maxRequestBytes } from "../src/api/handler";
import { loopbackPolicy } from "../src/api/server";
import { AppError, errorResponse } from "../src/domain/errors";
import { fixture, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(() => {
  f = fixture();
});
afterEach(async () => {
  await f.close();
});

const remember = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/memories", {
    method: "POST",
    headers: {
      Host: "localhost",
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });

function chunked(bytes: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= bytes) return controller.close();
      const size = Math.min(65_536, bytes - sent);
      controller.enqueue(new Uint8Array(size).fill(32));
      sent += size;
    },
  });
}

test("rejects declared and streamed bodies over the shared limit", async () => {
  const handler = createHttpHandler(f.app, loopbackPolicy);
  try {
    const declared = await handler.fetch(
      remember("{}", { "Content-Length": String(maxRequestBytes + 1) }),
    );
    expect(declared.status).toBe(413);
    expect(errorResponse.parse(await declared.json()).error.code).toBe(
      "PAYLOAD_TOO_LARGE",
    );
    const streamed = await handler.fetch(
      remember(chunked(maxRequestBytes + 1)),
    );
    expect(streamed.status).toBe(413);
    expect(errorResponse.parse(await streamed.json()).error.code).toBe(
      "PAYLOAD_TOO_LARGE",
    );
  } finally {
    await handler.close();
  }
});

test("accepts a streamed body within the limit", async () => {
  const handler = createHttpHandler(f.app, loopbackPolicy);
  try {
    const content = JSON.stringify({
      projectId: "test-project",
      agentId: "agent-a",
      type: "fact",
      content: "streamed body",
    });
    const encoded = new TextEncoder().encode(content);
    const response = await handler.fetch(
      remember(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoded);
            controller.close();
          },
        }),
      ),
    );
    expect(response.status).toBe(201);
  } finally {
    await handler.close();
  }
});

test("applies the injected policy and security headers to every response", async () => {
  const handler = createHttpHandler(f.app, () => {
    throw new AppError("FORBIDDEN", "Denied by policy.", 403);
  });
  try {
    const denied = await handler.fetch(new Request("http://localhost/health"));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("Cache-Control")).toBe("no-store");
    expect(denied.headers.get("X-Content-Type-Options")).toBe("nosniff");
  } finally {
    await handler.close();
  }
});
