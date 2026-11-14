import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

// Number coercion reads "" as 0, which would silently select a random port,
// and accepts hexadecimal and exponent forms. Require decimal digits.
function integer(min: number, max: number) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, "Must be a decimal integer.")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
}

const configSchema = z
  .object({
    host: z.enum(["127.0.0.1", "localhost", "::1"]).default("127.0.0.1"),
    port: integer(0, 65535).default(8787),
    dbPath: z
      .string()
      .trim()
      .min(1)
      .default(`${homedir()}/.agent-memory/memory.sqlite`),
    defaultTtlSeconds: integer(1, 2_147_483_647).default(1800),
    maxTtlSeconds: integer(1, 2_147_483_647).default(3600),
  })
  .refine(
    (value) => value.defaultTtlSeconds <= value.maxTtlSeconds,
    "Default claim TTL must not exceed maximum TTL.",
  );
export type Config = z.infer<typeof configSchema>;

export function readConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const config = configSchema.parse({
    host: env.AGENT_MEMORY_HOST,
    port: env.AGENT_MEMORY_PORT,
    dbPath: env.AGENT_MEMORY_DB,
    defaultTtlSeconds: env.AGENT_MEMORY_DEFAULT_CLAIM_TTL,
    maxTtlSeconds: env.AGENT_MEMORY_MAX_CLAIM_TTL,
  });
  const path = config.dbPath.startsWith("~/")
    ? `${homedir()}/${config.dbPath.slice(2)}`
    : config.dbPath;
  return { ...config, dbPath: resolve(path) };
}
