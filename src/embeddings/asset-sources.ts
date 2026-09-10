import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { modelFiles } from "./manifest";

export interface AssetSource {
  name: string;
  path: string;
  sha256: string;
}

// The compiler replaces this module with imports of the exact same embedded files.
// Development uses the pinned assets fetched by `bun run model:download`.
export function assetSources(): AssetSource[] {
  const root = resolve(import.meta.dir, "../..");
  const native = join(
    dirname(require.resolve("onnxruntime-node/package.json")),
    "bin/napi-v6",
    process.platform,
    process.arch,
  );
  const files = [
    // The macOS addon links libonnxruntime.1.dylib; the package also ships an
    // identical fully-versioned copy that is unnecessary in the executable.
    ...(process.platform === "darwin"
      ? ["onnxruntime_binding.node", "libonnxruntime.1.dylib"]
      : readdirSync(native).filter((name) =>
          /\.node$|\.so(\.\d+)*$|\.dll$/.test(name),
        )
    ).map((name) => ({ name, path: join(native, name) })),
    ...readdirSync(join(root, "licenses")).map((name) => ({
      name,
      path: join(root, "licenses", name),
    })),
    {
      name: "TOKENIZERS-LICENSE.txt",
      path: join(root, "node_modules/@huggingface/tokenizers/LICENSE"),
    },
  ];
  return [
    ...modelFiles.map((file) => ({
      name: file.name,
      path: join(root, ".assets/model", file.name),
      sha256: file.sha256,
    })),
    ...files.map((file) => ({
      ...file,
      sha256: createHash("sha256")
        .update(readFileSync(file.path))
        .digest("hex"),
    })),
  ];
}
