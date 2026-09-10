import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assetSources } from "../src/embeddings/asset-sources";
import { downloadModel } from "./download-model";

export async function build(
  entrypoint = resolve(import.meta.dir, "../src/index.ts"),
  outfile = "dist/memd",
): Promise<void> {
  await downloadModel();
  const sources = assetSources();
  const assetsModule = resolve(import.meta.dir, "../src/embeddings/assets.ts");
  const result = await Bun.build({
    entrypoints: [entrypoint],
    compile: { outfile },
    target: "bun",
    plugins: [
      {
        name: "offline-inference-assets",
        setup(builder) {
          builder.onLoad({ filter: /embeddings\/asset-sources\.ts$/ }, () => ({
            loader: "ts",
            contents:
              sources
                .map(
                  (source, index) =>
                    `import asset${index} from ${JSON.stringify(source.path)} with {type:"file"};`,
                )
                .join("\n") +
              `\nexport function assetSources() { return [${sources.map((source, index) => `{name:${JSON.stringify(source.name)},sha256:${JSON.stringify(source.sha256)},path:asset${index}}`).join(",")}]; }`,
          }));
          builder.onLoad(
            { filter: /onnxruntime-node\/dist\/binding\.js$/ },
            async ({ path }) => {
              const source = await readFile(path, "utf8");
              const loader =
                "require(`../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`)";
              if (source.split(loader).length !== 2)
                throw new Error(
                  "ONNX native loader changed; review the embedding build adapter.",
                );
              // Preserve the official SDK's initialization, replacing only native file resolution.
              return {
                loader: "js",
                contents: source.replace(
                  loader,
                  `require(require(${JSON.stringify(assetsModule)}).runtimeFile("onnxruntime_binding.node"))`,
                ),
              };
            },
          );
        },
      },
    ],
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Compilation failed");
  console.error(
    `Built ${outfile} with ${sources.length} offline assets for ${process.platform}-${process.arch}`,
  );
}
if (import.meta.main) await build();
