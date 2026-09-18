import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const installer = resolve(import.meta.dir, "../install.sh");
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(useBuiltBinary = false) {
  const directory = await mkdtemp(join(tmpdir(), "agent-memory-install-"));
  directories.push(directory);
  const commands = join(directory, "commands");
  const home = join(directory, "home with spaces");
  const downloads = join(directory, "downloads");
  await Promise.all([commands, home, downloads].map((path) => mkdir(path)));
  async function command(name: string, body: string) {
    const path = join(commands, name);
    await writeFile(path, `#!/bin/sh\nset -eu\n${body}\n`);
    await chmod(path, 0o755);
  }
  await command(
    "uname",
    'case "$1" in -s) echo "${TEST_OS:-Linux}";; -m) echo "${TEST_ARCH:-x86_64}";; esac',
  );
  await command(
    "getconf",
    '[ "${TEST_LIBC:-glibc}" = glibc ] && echo "glibc 2.35"',
  );
  await command(
    "curl",
    `
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --retry|--proto|--proto-redir|--write-out) shift 2 ;;
    --*) shift ;;
    *) url=$1; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$TEST_DIRECTORY/requests"
[ "\${TEST_DOWNLOAD_FAIL:-0}" = 0 ] || exit 22
case "$url" in
  */releases/latest) printf '%s' 'https://github.com/rhymiz/agent-memory/releases/tag/v0.6.0' ;;
  *) cp "$TEST_DIRECTORY/downloads/\${url##*/}" "$output" ;;
esac`,
  );
  if (process.platform === "darwin") {
    await command("sha256sum", 'exec /usr/bin/shasum -a 256 "$@"');
  }
  const builtBinary = useBuiltBinary
    ? process.env.INSTALLER_TEST_BINARY
    : undefined;
  const payload = builtBinary
    ? await readFile(builtBinary)
    : Buffer.from("#!/bin/sh\nprintf 'installed binary\\n'\n");
  for (const arch of ["x64", "arm64"]) {
    await writeFile(join(downloads, `memd-linux-${arch}`), payload);
  }
  const digest = createHash("sha256").update(payload).digest("hex");
  const checksums = ["x64", "arm64"]
    .map((arch) => `${digest}  memd-linux-${arch}\n`)
    .join("");
  await writeFile(join(downloads, "SHA256SUMS"), checksums);
  const binary = join(home, ".local/bin/memd");
  async function run(
    args: readonly string[] = [],
    env: Record<string, string | undefined> = {},
  ) {
    const child = Bun.spawn(["sh", installer, ...args], {
      cwd: directory,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${commands}:${process.env.PATH}`,
        TEST_DIRECTORY: directory,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  }
  return { directory, downloads, binary, payload, checksums, run };
}

test("latest resolves once, installs an executable, and pins both downloads to that release", async () => {
  const f = await fixture(true);
  const result = await f.run();
  expect(result.code).toBe(0);
  expect(await readFile(f.binary)).toEqual(f.payload);
  expect((await stat(f.binary)).mode & 0o777).toBe(0o755);
  expect(
    (await readFile(join(f.directory, "requests"), "utf8")).trim().split("\n"),
  ).toEqual([
    "https://github.com/rhymiz/agent-memory/releases/latest",
    "https://github.com/rhymiz/agent-memory/releases/download/v0.6.0/SHA256SUMS",
    "https://github.com/rhymiz/agent-memory/releases/download/v0.6.0/memd-linux-x64",
  ]);
  const child = Bun.spawn([f.binary, "--help"], {
    env: {
      ...process.env,
      AGENT_MEMORY_RUNTIME_DIR: join(f.directory, "runtime"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stdout).text()).toContain(
    process.env.INSTALLER_TEST_BINARY ? "Usage: memd" : "installed binary",
  );
}, 30_000);

test.each(["aarch64", "arm64", "amd64", "x86_64"])(
  "detects %s and supports a pinned version and custom directory",
  async (arch) => {
    const f = await fixture();
    const result = await f.run(
      ["--version", "0.6.0", "--bin-dir", "custom bin"],
      { TEST_ARCH: arch },
    );
    expect(result.code).toBe(0);
    expect(await readFile(join(f.directory, "custom bin/memd"))).toEqual(
      f.payload,
    );
    const requests = await readFile(join(f.directory, "requests"), "utf8");
    expect(requests).not.toContain("releases/latest");
    expect(requests).toContain(
      `memd-linux-${arch === "aarch64" || arch === "arm64" ? "arm64" : "x64"}`,
    );
  },
);

test.each(["mismatch", "missing", "duplicate", "malformed", "download"])(
  "preserves an existing binary after %s failure",
  async (failure) => {
    const f = await fixture();
    expect((await f.run()).code).toBe(0);
    await writeFile(f.binary, "old installation");
    if (failure === "mismatch")
      await writeFile(join(f.downloads, "memd-linux-x64"), "damaged download");
    if (failure === "missing")
      await writeFile(join(f.downloads, "SHA256SUMS"), "");
    if (failure === "duplicate")
      await writeFile(join(f.downloads, "SHA256SUMS"), f.checksums.repeat(2));
    if (failure === "malformed")
      await writeFile(
        join(f.downloads, "SHA256SUMS"),
        "not-a-hash  memd-linux-x64\n",
      );
    expect(
      (
        await f.run([], {
          TEST_DOWNLOAD_FAIL: failure === "download" ? "1" : "0",
        })
      ).code,
    ).not.toBe(0);
    expect(await readFile(f.binary, "utf8")).toBe("old installation");
  },
);

test("upgrades atomically over a symlink without overwriting its target", async () => {
  const f = await fixture();
  expect((await f.run()).code).toBe(0);
  const old = join(f.directory, "old-memd");
  await copyFile(f.binary, old);
  await writeFile(old, "previous version");
  await rm(f.binary);
  await symlink(old, f.binary);
  expect((await f.run()).code).toBe(0);
  expect(await readFile(old, "utf8")).toBe("previous version");
  expect(await readFile(f.binary)).toEqual(f.payload);
});

test.each([
  { TEST_OS: "Darwin" },
  { TEST_ARCH: "armv7l" },
  { TEST_LIBC: "musl" },
])("rejects unsupported hosts before downloading: %j", async (env) => {
  const f = await fixture();
  expect((await f.run([], env)).code).not.toBe(0);
  expect(await Bun.file(join(f.directory, "requests")).exists()).toBe(false);
});

test.each([
  { args: ["--version"] },
  { args: ["--bin-dir"] },
  { args: ["--unknown"] },
  { args: ["--version", "../../bad"] },
  { args: ["--version", "v0.6.0\nevil"] },
])("rejects invalid arguments: %j", async ({ args }) => {
  const f = await fixture();
  expect((await f.run(args)).code).not.toBe(0);
  expect(await Bun.file(join(f.directory, "requests")).exists()).toBe(false);
});
