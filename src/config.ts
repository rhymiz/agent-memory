import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

const configSchema = z
  .object({
    host: z.enum(["127.0.0.1", "localhost", "::1"]).default("127.0.0.1"),
    port: z.coerce.number().int().min(0).max(65535).default(8787),
    dbPath: z
      .string()
      .trim()
      .min(1)
      .default(`${homedir()}/.agent-memory/memory.sqlite`),
    defaultTtlSeconds: z.coerce
      .number()
      .int()
      .min(1)
      .max(2_147_483_647)
      .default(1800),
    maxTtlSeconds: z.coerce
      .number()
      .int()
      .min(1)
      .max(2_147_483_647)
      .default(3600),
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
