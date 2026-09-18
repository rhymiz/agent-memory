import { readFile } from "node:fs/promises";
import { MemoryClient } from "../src/client/memory-client";
import { evaluationCases, evaluateCase } from "./lib/retrieval-evaluation";

const [casesPath, baseUrl = "http://127.0.0.1:8787", ...extra] =
  process.argv.slice(2);
if (!casesPath || extra.length)
  throw new Error(
    "Usage: bun run retrieval:evaluate <cases.json> [daemon-url]",
  );
const value: unknown = JSON.parse(await readFile(casesPath, "utf8"));
const cases = evaluationCases.parse(value);
const results = [];
for (const item of cases) {
  const client = new MemoryClient({
    baseUrl,
    projectId: item.projectId,
    agentId: "retrieval-evaluation",
  });
  results.push(await evaluateCase(item, client));
}
console.log(
  JSON.stringify({ evaluatedAt: Date.now(), cases: results }, null, 2),
);
