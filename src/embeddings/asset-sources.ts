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
    // Bundle the CPU runtime only, regardless of optional CUDA downloads in
    // node_modules. macOS also ships a duplicate fully-versioned library.
    ...(process.platform === "darwin"
      ? ["onnxruntime_binding.node", "libonnxruntime.1.dylib"]
      : process.platform === "linux"
        ? ["onnxruntime_binding.node", "libonnxruntime.so.1"]
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
