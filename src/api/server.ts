import type { Application } from "../application";
import type { Config } from "../config";
import { AppError, publicError } from "../domain/errors";
import { createMcpHttpHandler } from "../mcp/server";
import { createRouter } from "./router";

function guard(request: Request): void {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) {
    throw new AppError(
      "FORBIDDEN",
      "Only localhost Host headers are accepted.",
      403,
    );
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin)
    throw new AppError(
      "FORBIDDEN",
      "Cross-origin requests are not allowed.",
      403,
    );
}

export function startHttpServer(
  app: Application,
  config: Pick<Config, "host" | "port">,
) {
  const rest = createRouter(app);
  const mcp = createMcpHttpHandler(app);
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    maxRequestBodySize: 1_048_576,
    async fetch(request) {
      try {
        guard(request);
        const response = await (new URL(request.url).pathname === "/mcp"
          ? mcp.fetch(request)
          : rest(request));
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("X-Content-Type-Options", "nosniff");
        return response;
      } catch (error) {
        const failure = publicError(error);
        return Response.json(failure.toJSON(), { status: failure.status });
      }
    },
  });
  return {
    url: server.url,
    port: server.port,
    async stop(force = false) {
      await server.stop(force);
      await mcp.close();
    },
  };
}
