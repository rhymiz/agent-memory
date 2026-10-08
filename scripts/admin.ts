// Hosted service key administration.
//   bun run admin keys list [--account <id>]
//   bun run admin keys create --account <id> --name <name> --projects <a,b|all> --access <read|write> [--expires-days <n>]
//   bun run admin keys revoke <keyId>
// Reads AGENT_MEMORY_URL (the service origin) and AGENT_MEMORY_ADMIN_TOKEN.
import { parseArgs } from "node:util";
import { z } from "zod";
import { accessLevel, grant } from "../src/domain/access";
import { identifier } from "../src/domain/contracts";
import { apiKey, issuedKey, keyList, keyName } from "../src/domain/credentials";
import { errorResponse } from "../src/domain/errors";

const environment = z.object({
  AGENT_MEMORY_URL: z
    .url()
    .refine(
      (value) =>
        new URL(value).protocol === "https:" ||
        ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname),
      "AGENT_MEMORY_URL must use https unless it is a loopback address.",
    ),
  AGENT_MEMORY_ADMIN_TOKEN: z.string().min(1),
});

async function call<T>(
  schema: z.ZodType<T>,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const env = environment.parse(process.env);
  const response = await fetch(new URL(path, env.AGENT_MEMORY_URL), {
    ...init,
    headers: {
      Authorization: `Bearer ${env.AGENT_MEMORY_ADMIN_TOKEN}`,
      ...(init.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const failure = errorResponse.safeParse(data);
    throw new Error(
      failure.success
        ? `${failure.data.error.code}: ${failure.data.error.message}`
        : `Service returned HTTP ${response.status}.`,
    );
  }
  return schema.parse(data);
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      account: { type: "string" },
      name: { type: "string" },
      projects: { type: "string" },
      access: { type: "string" },
      "expires-days": { type: "string" },
    },
  });
  const [group, command, target] = positionals;
  if (group !== "keys")
    throw new Error("Usage: admin keys <list|create|revoke>");
  if (command === "list") {
    const query =
      values.account === undefined
        ? ""
        : `?accountId=${encodeURIComponent(identifier.parse(values.account))}`;
    console.log(
      JSON.stringify(await call(keyList, `/admin/keys${query}`), null, 2),
    );
    return;
  }
  if (command === "create") {
    const days =
      values["expires-days"] === undefined
        ? undefined
        : z.coerce.number().int().positive().parse(values["expires-days"]);
    const projects = z.string().min(1).parse(values.projects);
    const body = {
      accountId: identifier.parse(values.account),
      name: keyName.parse(values.name),
      grant: grant.parse({
        projects: projects === "all" ? "all" : projects.split(","),
        access: accessLevel.parse(values.access),
      }),
      ...(days === undefined
        ? {}
        : { expiresAt: Date.now() + days * 86_400_000 }),
    };
    const issued = await call(issuedKey, "/admin/keys", {
      method: "POST",
      body: JSON.stringify(body),
    });
    console.log(JSON.stringify(issued.key, null, 2));
    console.error("API key (shown once; store it in a secret manager):");
    console.log(issued.token);
    return;
  }
  if (command === "revoke") {
    const keyId = identifier.parse(target);
    console.log(
      JSON.stringify(
        await call(apiKey, `/admin/keys/${encodeURIComponent(keyId)}/revoke`, {
          method: "POST",
        }),
        null,
        2,
      ),
    );
    return;
  }
  throw new Error("Usage: admin keys <list|create|revoke>");
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
