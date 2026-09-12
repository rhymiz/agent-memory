import { z } from "zod";
import type { Application } from "../application";
import * as c from "../domain/contracts";
import { AppError, parseInput, publicError } from "../domain/errors";

type Params = Record<string, string>;
type Handler = (
  request: Request,
  url: URL,
  params: Params,
) => Response | Promise<Response>;
interface Route {
  method: string;
  path: RegExp;
  handle: Handler;
}

async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    throw new AppError(
      "INVALID_REQUEST",
      "Content-Type must be application/json.",
      415,
    );
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new AppError("INVALID_REQUEST", "Body must contain valid JSON.");
  }
  return parseInput(schema, value);
}

function query<T>(url: URL, schema: z.ZodType<T>, extra: Params = {}): T {
  const values: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(values, key))
      throw new AppError(
        "INVALID_REQUEST",
        `Query parameter ${key} must not be repeated.`,
      );
    values[key] = value;
  }
  for (const key of ["limit", "since", "maxBytes"]) {
    const value = values[key];
    if (typeof value === "string" && /^\d+$/.test(value))
      values[key] = Number(value);
  }
  if (
    url.pathname === "/memories/search" ||
    url.pathname === "/memories/search/compact"
  ) {
    if (Object.hasOwn(values, "query"))
      throw new AppError(
        "INVALID_REQUEST",
        "Use the q query parameter for memory search.",
      );
    values.query = values.q;
    delete values.q;
  }
  for (const key of Object.keys(extra)) {
    if (Object.hasOwn(values, key))
      throw new AppError(
        "INVALID_REQUEST",
        `${key} is specified by the URL path.`,
      );
  }
  return parseInput(schema, { ...values, ...extra });
}

export function createRouter(
  app: Application,
): (request: Request) => Promise<Response> {
  const routes: Route[] = [
    {
      method: "GET",
      path: /^\/health$/,
      handle: () => Response.json(app.health()),
    },
    {
      method: "POST",
      path: /^\/memories$/,
      handle: async (request) =>
        Response.json(
          await app.memories.remember(await body(request, c.rememberInput)),
          { status: 201 },
        ),
    },
    {
      method: "GET",
      path: /^\/memories\/search$/,
      handle: async (_, url) =>
        Response.json(await app.memories.search(query(url, c.searchInput))),
    },
    {
      method: "GET",
      path: /^\/memories\/search\/compact$/,
      handle: async (_, url) =>
        Response.json(
          await app.memories.searchCompact(query(url, c.compactSearchInput)),
        ),
    },
    {
      method: "GET",
      path: /^\/memories\/(?<memoryId>[^/]+)$/,
      handle: (_, url, params) =>
        Response.json(app.memories.get(query(url, c.memoryGetInput, params))),
    },
    {
      method: "PATCH",
      path: /^\/memories\/(?<memoryId>[^/]+)$/,
      handle: async (request, _, params) => {
        const input = await body(request, c.memoryUpdateBody);
        return Response.json(
          await app.memories.update(
            parseInput(c.memoryUpdateInput, { ...input, ...params }),
          ),
        );
      },
    },
    {
      method: "DELETE",
      path: /^\/memories\/(?<memoryId>[^/]+)$/,
      handle: async (request, _, params) => {
        const input = await body(request, c.memoryDeleteBody);
        return Response.json(
          app.memories.delete(
            parseInput(c.memoryDeleteInput, { ...input, ...params }),
          ),
        );
      },
    },
    {
      method: "POST",
      path: /^\/claims$/,
      handle: async (request) =>
        Response.json(app.claims.acquire(await body(request, c.acquireInput)), {
          status: 201,
        }),
    },
    {
      method: "GET",
      path: /^\/claims$/,
      handle: (_, url) =>
        Response.json(app.claims.list(query(url, c.claimsInput))),
    },
    {
      method: "POST",
      path: /^\/claims\/renew$/,
      handle: async (request) =>
        Response.json(
          app.claims.renewMany(await body(request, c.renewClaimsInput)),
        ),
    },
    {
      method: "POST",
      path: /^\/claims\/(?<claimId>[^/]+)\/renew$/,
      handle: async (request, _, params) => {
        const input = await body(request, c.renewInput.omit({ claimId: true }));
        return Response.json(
          app.claims.renew(parseInput(c.renewInput, { ...input, ...params })),
        );
      },
    },
    {
      method: "DELETE",
      path: /^\/claims\/(?<claimId>[^/]+)$/,
      handle: async (request, _, params) => {
        const input = await body(
          request,
          c.releaseInput.omit({ claimId: true }),
        );
        return Response.json(
          app.claims.release(
            parseInput(c.releaseInput, { ...input, ...params }),
          ),
        );
      },
    },
    {
      method: "POST",
      path: /^\/projects\/(?<projectId>[^/]+)\/briefing$/,
      handle: async (request, _, params) => {
        const input = await body(
          request,
          c.briefingInput.omit({ projectId: true }),
        );
        return Response.json(
          await app.briefing.get(
            parseInput(c.briefingInput, { ...input, ...params }),
          ),
        );
      },
    },
    {
      method: "GET",
      path: /^\/projects\/(?<projectId>[^/]+)\/context$/,
      handle: (_, url, params) =>
        Response.json(app.context.get(query(url, c.projectInput, params))),
    },
    {
      method: "PUT",
      path: /^\/projects\/(?<projectId>[^/]+)\/context$/,
      handle: async (request, _, params) => {
        const input = await body(request, c.contextUpdateBody);
        return Response.json(
          app.context.update(
            parseInput(c.contextUpdateInput, { ...input, ...params }),
          ),
        );
      },
    },
    {
      method: "POST",
      path: /^\/projects\/(?<projectId>[^/]+)\/decisions$/,
      handle: async (request, _, params) => {
        const input = await body(request, c.decisionBody);
        return Response.json(
          app.decisions.record(
            parseInput(c.decisionInput, { ...input, ...params }),
          ),
          { status: 201 },
        );
      },
    },
    {
      method: "GET",
      path: /^\/projects\/(?<projectId>[^/]+)\/decisions$/,
      handle: (_, url, params) =>
        Response.json(app.decisions.list(query(url, c.decisionsInput, params))),
    },
    {
      method: "GET",
      path: /^\/projects\/(?<projectId>[^/]+)\/activity$/,
      handle: (_, url, params) =>
        Response.json(app.activity.recent(query(url, c.activityInput, params))),
    },
  ];
  return async (request) => {
    try {
      const url = new URL(request.url);
      const allowed: string[] = [];
      for (const route of routes) {
        const match = route.path.exec(url.pathname);
        if (!match) continue;
        allowed.push(route.method);
        if (request.method !== route.method) continue;
        const params: Params = {};
        for (const [key, value] of Object.entries(match.groups ?? {})) {
          try {
            params[key] = decodeURIComponent(value);
          } catch {
            throw new AppError("INVALID_REQUEST", "Malformed URL encoding.");
          }
        }
        return await route.handle(request, url, params);
      }
      if (allowed.length)
        return Response.json(
          new AppError(
            "METHOD_NOT_ALLOWED",
            "Method not allowed.",
            405,
          ).toJSON(),
          { status: 405, headers: { Allow: allowed.join(", ") } },
        );
      throw new AppError("NOT_FOUND", "Endpoint does not exist.", 404);
    } catch (error) {
      const failure = publicError(error);
      const data =
        failure.code === "CLAIM_CONFLICT"
          ? { ...failure.toJSON(), granted: false, conflict: failure.details }
          : failure.toJSON();
      return Response.json(data, { status: failure.status });
    }
  };
}
