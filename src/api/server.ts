import type { Application } from "../application";
import type { Config } from "../config";
import { AppError } from "../domain/errors";
import { createHttpHandler, maxRequestBytes } from "./handler";

// The daemon trusts local processes; reject DNS rebinding and browser cross-origin requests.
export function loopbackPolicy(request: Request): void {
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
  const handler = createHttpHandler(app, loopbackPolicy);
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    maxRequestBodySize: maxRequestBytes,
    fetch: (request) => handler.fetch(request),
  });
  return {
    url: server.url,
    port: server.port,
    async stop(force = false) {
      await server.stop(force);
      await handler.close();
    },
  };
}
