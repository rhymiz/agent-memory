// Hosted service key and member administration.
//   bun run admin keys list [--account <id>]
//   bun run admin keys create --account <id> --name <name> --projects <a,b|all> --access <read|write> [--expires-days <n>]
//   bun run admin keys revoke <keyId>
//   bun run admin members list [--account <id>]
//   bun run admin members add --account <id> --github <login> --projects <a,b|all> --access <read|write>
//   bun run admin members revoke <memberId>
// Reads AGENT_MEMORY_URL (the service origin) and AGENT_MEMORY_ADMIN_TOKEN.
import { parseArgs } from "node:util";
import { z } from "zod";
import { accessLevel, grant } from "../src/domain/access";
import { identifier } from "../src/domain/contracts";
import { apiKey, issuedKey, keyList, keyName } from "../src/domain/credentials";
import { errorResponse } from "../src/domain/errors";
import { member, memberList } from "../src/domain/members";

const usage = "Usage: admin <keys|members> <list|create|add|revoke>";
const githubUser = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
});

// Members are stored by GitHub's numeric user ID, which survives renames.
async function resolveGitHubUser(login: string) {
  const response = await fetch(
    `https://api.github.com/users/${encodeURIComponent(login)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "agent-memory-admin",
      },
    },
  );
  if (!response.ok)
    throw new Error(
      `GitHub user ${login} was not found (HTTP ${response.status}).`,
    );
  return githubUser.parse(await response.json());
}

function parseGrant(projects: string | undefined, access: string | undefined) {
  const list = z.string().min(1).parse(projects);
  return grant.parse({
    projects: list === "all" ? "all" : list.split(","),
    access: accessLevel.parse(access),
  });
}

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
      github: { type: "string" },
    },
  });
  const [group, command, target] = positionals;
  const query =
    values.account === undefined
      ? ""
      : `?accountId=${encodeURIComponent(identifier.parse(values.account))}`;
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (group === "members") {
    if (command === "list")
      return print(await call(memberList, `/admin/members${query}`));
    if (command === "add") {
      const user = await resolveGitHubUser(
        z.string().min(1).parse(values.github),
      );
      return print(
        await call(member, "/admin/members", {
          method: "POST",
          body: JSON.stringify({
            accountId: identifier.parse(values.account),
            provider: "github",
            subject: String(user.id),
            login: user.login,
            grant: parseGrant(values.projects, values.access),
          }),
        }),
      );
    }
    if (command === "revoke") {
      const memberId = identifier.parse(target);
      return print(
        await call(
          member,
          `/admin/members/${encodeURIComponent(memberId)}/revoke`,
          { method: "POST" },
        ),
      );
    }
    throw new Error(usage);
  }
  if (group !== "keys") throw new Error(usage);
  if (command === "list")
    return print(await call(keyList, `/admin/keys${query}`));
  if (command === "create") {
    const days =
      values["expires-days"] === undefined
        ? undefined
        : z.coerce.number().int().positive().parse(values["expires-days"]);
    const body = {
      accountId: identifier.parse(values.account),
      name: keyName.parse(values.name),
      grant: parseGrant(values.projects, values.access),
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
  throw new Error(usage);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
