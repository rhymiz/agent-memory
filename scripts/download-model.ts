import { createHash } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { model, modelFiles } from "../src/embeddings/manifest";

export async function downloadModel(): Promise<void> {
  const directory = join(import.meta.dir, "../.assets/model");
  await mkdir(directory, { recursive: true });
  for (const file of modelFiles) {
    const path = join(directory, file.name);
    const hash = async (path: string) =>
      createHash("sha256")
        .update(await Bun.file(path).bytes())
        .digest("hex");
    if ((await Bun.file(path).exists()) && (await hash(path)) === file.sha256)
      continue;
    console.error(
      `Downloading ${model.repository}@${model.revision}/${file.remote}`,
    );
    const response = await fetch(
      `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.remote}`,
    );
    if (!response.ok)
      throw new Error(`Model download failed: HTTP ${response.status}`);
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await Bun.write(temporary, response);
      if ((await hash(temporary)) !== file.sha256)
        throw new Error(`Model checksum mismatch: ${file.name}`);
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
if (import.meta.main) await downloadModel();
