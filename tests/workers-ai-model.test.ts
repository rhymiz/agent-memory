import { expect, test } from "bun:test";
import {
  documentChunks,
  WorkersAiEmbeddingModel,
  type EmbeddingRunner,
} from "../src/cloudflare/workers-ai-model";

class RecordingRunner implements EmbeddingRunner {
  readonly calls: string[][] = [];
  constructor(
    private readonly respond: (texts: string[]) => unknown = (texts) => ({
      shape: [texts.length, 768],
      data: texts.map((_, index) =>
        Array.from({ length: 768 }, (__, i) => (i === index % 768 ? 1 : 0)),
      ),
    }),
  ) {}
  async run(_model: string, input: { text: string[] }): Promise<unknown> {
    this.calls.push(input.text);
    return this.respond(input.text);
  }
}

const length = (text: string) => Array.from(text).length;

test("document chunks stay within the character bound and overlap", () => {
  const paragraph =
    Array.from({ length: 500 }, (_, i) => i % 10).join("") +
    Array.from({ length: 300 }, (_, i) => `w${i}`).join("");
  const chunks = documentChunks(paragraph);
  expect(chunks).toHaveLength(Math.ceil((length(paragraph) - 80) / 560));
  expect(chunks.every((chunk) => length(chunk) <= 640)).toBe(true);
  for (let i = 1; i < chunks.length; i++)
    expect(chunks[i]!.startsWith(chunks[i - 1]!.slice(-80))).toBe(true);
  // Count code points, not UTF-16 units, so astral scripts keep the bound.
  const astral = documentChunks("𝔄".repeat(1000));
  expect(astral.every((chunk) => length(chunk) <= 640)).toBe(true);
});

test("short paragraphs are grouped without exceeding the bound", () => {
  const paragraphs = Array.from({ length: 12 }, (_, i) =>
    `note ${i} `.repeat(10),
  );
  const chunks = documentChunks(paragraphs.join("\n\n"));
  expect(chunks.length).toBeLessThan(paragraphs.length);
  expect(chunks.every((chunk) => length(chunk) <= 640)).toBe(true);
  expect(documentChunks("one\n\ntwo")).toEqual(["one\n\ntwo"]);
});

test("documents are embedded in bounded batches with the document prompt", async () => {
  const runner = new RecordingRunner();
  const model = new WorkersAiEmbeddingModel(runner);
  const text = Array.from({ length: 40 }, (_, i) =>
    `paragraph ${i} `.repeat(30),
  ).join("\n\n");
  const vectors = await model.embedDocument(text);
  expect(vectors).toHaveLength(runner.calls.flat().length);
  expect(runner.calls.every((batch) => batch.length <= 16)).toBe(true);
  expect(runner.calls.length).toBeGreaterThan(1);
  expect(
    runner.calls
      .flat()
      .every((input) => input.startsWith("title: none | text: ")),
  ).toBe(true);
});

test("queries use the query prompt and are clipped to the bound", async () => {
  const runner = new RecordingRunner();
  const model = new WorkersAiEmbeddingModel(runner);
  await model.embedQuery("ᐁ".repeat(1000));
  const [input] = runner.calls.flat();
  expect(input?.startsWith("task: search result | query: ")).toBe(true);
  expect(length(input ?? "") - length("task: search result | query: ")).toBe(
    640,
  );
});

test("malformed Workers AI output is rejected", async () => {
  const wrongCount = new WorkersAiEmbeddingModel(
    new RecordingRunner(() => ({ shape: [0, 768], data: [] })),
  );
  expect(wrongCount.embedQuery("q")).rejects.toThrow("unexpected number");
  const wrongDimensions = new WorkersAiEmbeddingModel(
    new RecordingRunner(() => ({ shape: [1, 3], data: [[1, 0, 0]] })),
  );
  expect(wrongDimensions.embedQuery("q")).rejects.toThrow("dimensions");
  const wrongShape = new WorkersAiEmbeddingModel(
    new RecordingRunner(() => ({ vectors: [] })),
  );
  expect(wrongShape.embedQuery("q")).rejects.toThrow();
});

test("the model identity encodes its prompt and chunking contract", () => {
  const model = new WorkersAiEmbeddingModel(new RecordingRunner());
  expect(model.id).toBe(
    "workers-ai:@cf/google/embeddinggemma-300m:768:chars640-80:paragraphs-v1",
  );
  expect(model.dimensions).toBe(768);
});
