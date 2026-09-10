import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { assetSources } from "./asset-sources";

let directory: string | undefined;
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ONNX's synchronous native loader needs this before application modules initialize.
// Keep path resolution independent of schema-library initialization.
export function readRuntimeDirectory(
  env: Record<string, string | undefined> = process.env,
): string {
  const path = (
    env.AGENT_MEMORY_RUNTIME_DIR ?? `${homedir()}/.agent-memory/runtime`
  ).trim();
  if (!path) throw new Error("AGENT_MEMORY_RUNTIME_DIR must not be empty");
  return resolve(
    path.startsWith("~/") ? `${homedir()}/${path.slice(2)}` : path,
  );
}

export function runtimeFile(name: string): string {
  if (!directory) {
    const sources = assetSources();
    const key = digest(
      Buffer.from(
        JSON.stringify(sources.map(({ name, sha256 }) => ({ name, sha256 }))),
      ),
    ).slice(0, 24);
    const root = readRuntimeDirectory();
    const target = join(root, `${process.platform}-${process.arch}-${key}`);
    mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const source of sources) {
      const path = join(target, source.name);
      try {
        if (digest(readFileSync(path)) === source.sha256) continue;
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
      let bytes: Uint8Array;
      try {
        bytes = readFileSync(source.path);
      } catch (error) {
        throw new Error(
          `Cannot read asset ${source.name}. Run bun run model:download before starting from source.`,
          { cause: error },
        );
      }
      if (digest(bytes) !== source.sha256)
        throw new Error(
          `Asset checksum failed: ${source.name}. Run bun run model:download before building.`,
        );
      const temporary = `${path}.${process.pid}.${Bun.randomUUIDv7()}.tmp`;
      try {
        writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    directory = target;
  }
  return join(directory, name);
}
