import { z } from "zod";

const startedSchema = z.object({
  event: z.literal("daemon.started"),
  url: z.url(),
});

export async function startDaemon(dbPath: string) {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/../src/index.ts`],
    {
      env: {
        ...process.env,
        AGENT_MEMORY_DB: dbPath,
        AGENT_MEMORY_HOST: "127.0.0.1",
        AGENT_MEMORY_PORT: "0",
        AGENT_MEMORY_DEFAULT_CLAIM_TTL: "300",
        AGENT_MEMORY_MAX_CLAIM_TTL: "3600",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  let diagnostics = "";
  const ready = Promise.withResolvers<string>();
  async function readLogs(): Promise<void> {
    const reader = child.stderr.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const text = decoder.decode(chunk.value, { stream: true });
        diagnostics += text;
        buffered += text;
        let newline: number;
        while ((newline = buffered.indexOf("\n")) !== -1) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          try {
            const value: unknown = JSON.parse(line);
            const started = startedSchema.safeParse(value);
            if (started.success) ready.resolve(started.data.url);
          } catch {
            /* Preserve non-JSON startup diagnostics for errors. */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  const logs = readLogs();
  void logs.catch(ready.reject);
  void child.exited.then((code) =>
    ready.reject(new Error(`Daemon exited (${code}): ${diagnostics}`)),
  );
  const timer = setTimeout(
    () => ready.reject(new Error(`Daemon did not start: ${diagnostics}`)),
    10_000,
  );
  try {
    const baseUrl = await ready.promise;
    return {
      child,
      baseUrl,
      async stop() {
        child.kill("SIGTERM");
        await child.exited;
        await logs;
      },
    };
  } catch (error) {
    child.kill("SIGKILL");
    await child.exited;
    await logs;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
