import type { Application } from "../application";
import { AppError, publicError } from "../domain/errors";
import { createMcpHttpHandler } from "../mcp/server";
import { createRouter } from "./router";

export const maxRequestBytes = 1_048_576;

// Decides whether a request may reach the application. Throws AppError to reject.
export type RequestPolicy = (request: Request) => void | Promise<void>;

export interface HttpHandler {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

function tooLarge(): AppError {
  return new AppError(
    "PAYLOAD_TOO_LARGE",
    `Request body must not exceed ${maxRequestBytes} bytes.`,
    413,
  );
}

// Enforce the body limit in the shared handler so every runtime applies it,
// including chunked bodies that declare no length.
async function bounded(request: Request): Promise<Request> {
  if (request.body === null) return request;
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (Number(declared) > maxRequestBytes) throw tooLarge();
    return request;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxRequestBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}

export function createHttpHandler(
  app: Application,
  policy: RequestPolicy,
): HttpHandler {
  const rest = createRouter(app);
  const mcp = createMcpHttpHandler(app);
  return {
    async fetch(request) {
      let response: Response;
      try {
        await policy(request);
        const accepted = await bounded(request);
        response = await (new URL(accepted.url).pathname === "/mcp"
          ? mcp.fetch(accepted)
          : rest(accepted));
      } catch (error) {
        const failure = publicError(error);
        response = Response.json(failure.toJSON(), { status: failure.status });
      }
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    },
    close: () => mcp.close(),
  };
}
