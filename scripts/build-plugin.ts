import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

const manifestIdentity = z.object({
  name: z.literal("agent-memory"),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
});

async function filesIn(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Plugin packages must contain regular files: ${path}`);
  }
  return files.sort();
}

async function archive(sourceParent: string, name: string, output: string) {
  const process = Bun.spawn(["tar", "-czf", output, "-C", sourceParent, name], {
    env: { ...Bun.env, COPYFILE_DISABLE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const error = await new Response(process.stderr).text();
  if ((await process.exited) !== 0) throw new Error(`tar failed: ${error}`);
}

export async function buildPlugin(
  pluginDirectory: string,
  outputDirectory: string,
) {
  const plugin = resolve(pluginDirectory);
  const output = resolve(outputDirectory);
  const outputRelative = relative(plugin, output);
  if (outputRelative.split(sep)[0] !== "..") {
    throw new Error("Build output must be outside the plugin directory");
  }
  const manifests = await Promise.all(
    [
      "plugin.json",
      ".codex-plugin/plugin.json",
      ".claude-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
    ].map(async (path) =>
      manifestIdentity.parse(
        JSON.parse(await readFile(join(plugin, path), "utf8")),
      ),
    ),
  );
  const identity = manifests[0];
  if (
    !identity ||
    manifests.some((manifest) => manifest.version !== identity.version)
  ) {
    throw new Error("Plugin manifest versions must match");
  }
  if (basename(plugin) !== identity.name) {
    throw new Error("Plugin directory must match its manifest name");
  }
  await filesIn(plugin);
  await mkdir(output, { recursive: true });
  const bundles = [
    {
      name: `agent-memory-plugin-${identity.version}.tar.gz`,
      parent: dirname(plugin),
      directory: "agent-memory",
    },
    {
      name: `agent-memory-skill-${identity.version}.tar.gz`,
      parent: join(plugin, "skills"),
      directory: "shared-agent-memory",
    },
  ];
  const checksums: string[] = [];
  for (const bundle of bundles) {
    const path = join(output, bundle.name);
    await archive(bundle.parent, bundle.directory, path);
    const hash = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    checksums.push(`${hash}  ${bundle.name}`);
  }
  await writeFile(join(output, "SHA256SUMS"), `${checksums.join("\n")}\n`);
  return {
    version: identity.version,
    output,
    files: [...bundles.map((bundle) => bundle.name), "SHA256SUMS"],
  };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  console.log(
    JSON.stringify(
      await buildPlugin(
        join(root, "plugins/agent-memory"),
        process.argv[2] ?? join(root, "dist/plugins"),
      ),
    ),
  );
}
