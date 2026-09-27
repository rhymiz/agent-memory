import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPlugin } from "../scripts/build-plugin";
import { z } from "zod";

const plugin = resolve(import.meta.dir, "../plugins/agent-memory");
const mcpConfig = z.object({
  mcpServers: z.strictObject({
    "agent-memory": z.strictObject({ type: z.string(), url: z.url() }),
  }),
});

test("release archives retain self-contained guidance, native manifests and equivalent MCP connections", async () => {
  const temp = await mkdtemp(join(tmpdir(), "memory plugin "));
  try {
    const output = join(temp, "release files");
    const built = await buildPlugin(plugin, output);
    for (const name of built.files.filter((name) => name.endsWith(".tar.gz"))) {
      const child = Bun.spawn(["tar", "-xzf", join(output, name), "-C", temp], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await child.exited).toBe(0);
    }
    const bundled = join(temp, "agent-memory");
    const standalone = join(temp, "shared-agent-memory");
    const original = join(plugin, "skills/shared-agent-memory");
    for (const file of [
      "SKILL.md",
      ...(await readdir(join(original, "references"))).map(
        (name) => `references/${name}`,
      ),
    ]) {
      const content = await readFile(join(original, file), "utf8");
      expect(
        await readFile(
          join(bundled, "skills/shared-agent-memory", file),
          "utf8",
        ),
      ).toBe(content);
      expect(await readFile(join(standalone, file), "utf8")).toBe(content);
    }
    for (const file of [
      "plugin.json",
      ".codex-plugin/plugin.json",
      ".claude-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
      "README.md",
    ]) {
      expect(await readFile(join(bundled, file), "utf8")).toBe(
        await readFile(join(plugin, file), "utf8"),
      );
    }
    const portable = mcpConfig.parse(
      JSON.parse(await readFile(join(bundled, "mcp.json"), "utf8")),
    );
    const native = mcpConfig.parse(
      JSON.parse(await readFile(join(bundled, ".mcp.json"), "utf8")),
    );
    expect(portable.mcpServers).toEqual({
      "agent-memory": {
        type: "streamable-http",
        url: "http://127.0.0.1:8787/mcp",
      },
    });
    expect(native.mcpServers).toEqual({
      "agent-memory": {
        type: "http",
        url: portable.mcpServers["agent-memory"].url,
      },
    });
    for (const line of (await readFile(join(output, "SHA256SUMS"), "utf8"))
      .trim()
      .split("\n")) {
      const [hash, name] = line.split("  ");
      expect(name).toBeDefined();
      if (!name || !hash) throw new Error("Missing archive name or checksum");
      expect(
        createHash("sha256")
          .update(await readFile(join(output, name)))
          .digest("hex"),
      ).toBe(hash);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("packaging rejects references outside the bundle and inconsistent host versions", async () => {
  const temp = await mkdtemp(join(tmpdir(), "memory-plugin-invalid-"));
  try {
    const copy = join(temp, "agent-memory");
    await cp(plugin, copy, { recursive: true });
    await symlink("../../outside", join(copy, "escaped"));
    await expect(buildPlugin(copy, join(temp, "output"))).rejects.toThrow(
      "regular files",
    );
    await rm(join(copy, "escaped"));
    await writeFile(
      join(copy, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "agent-memory", version: "99.0.0" }),
    );
    await expect(buildPlugin(copy, join(temp, "output"))).rejects.toThrow(
      "versions must match",
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
