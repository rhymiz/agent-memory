import { z } from "zod";
import { normalized, type EmbeddingModel } from "../domain/embedding";

const name = "@cf/google/embeddinggemma-300m";
const dimensions = 768;
// EmbeddingGemma's context is 2,048 tokens, and byte-fallback scripts can use
// about three tokens per character. Without the tokenizer in the Worker, bound
// chunks by characters so every input stays inside the context.
const chunkChars = 640;
const overlapChars = 80;
const shortParagraphChars = 320;
const maxQueryChars = 640;
const batchSize = 16;
const queryPrefix = "task: search result | query: ";
const documentPrefix = "title: none | text: ";

// The slice of the Workers AI binding this model uses; env.AI satisfies it.
export interface EmbeddingRunner {
  run(model: typeof name, input: { text: string[] }): Promise<unknown>;
}

const output = z.object({
  data: z.array(z.array(z.number())),
});

function windows(paragraph: string): string[] {
  const chars = Array.from(paragraph);
  const result: string[] = [];
  for (let start = 0; ; start += chunkChars - overlapChars) {
    result.push(chars.slice(start, start + chunkChars).join(""));
    if (start + chunkChars >= chars.length) return result;
  }
}

export function documentChunks(text: string): string[] {
  const chunks = new Set<string>();
  let short: string[] = [];
  let shortLength = 0;
  const flush = () => {
    if (short.length) chunks.add(short.join("\n\n"));
    short = [];
    shortLength = 0;
  };
  for (const paragraph of text
    .split(/\n\s*\n/u)
    .filter((part) => part.trim())) {
    const length = Array.from(paragraph).length;
    // Keep paragraph boundaries; group short paragraphs to bound inference work.
    if (length < shortParagraphChars) {
      if (shortLength + length > chunkChars) flush();
      short.push(paragraph);
      shortLength += length;
      if (shortLength >= shortParagraphChars) flush();
      continue;
    }
    flush();
    for (const chunk of windows(paragraph)) chunks.add(chunk);
  }
  flush();
  return chunks.size ? [...chunks] : windows(text);
}

export class WorkersAiEmbeddingModel implements EmbeddingModel {
  // Includes the prompt and chunking contract, so a change forces reindexing.
  readonly id = `workers-ai:${name}:${dimensions}:chars${chunkChars}-${overlapChars}:paragraphs-v1`;
  readonly dimensions = dimensions;
  constructor(private readonly ai: EmbeddingRunner) {}

  private async infer(texts: string[]): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const result = output.parse(await this.ai.run(name, { text: batch }));
      if (result.data.length !== batch.length)
        throw new Error(
          "Workers AI returned an unexpected number of embeddings",
        );
      for (const values of result.data)
        vectors.push(normalized(Float32Array.from(values), this.dimensions));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const clipped = Array.from(text).slice(0, maxQueryChars).join("");
    const [vector] = await this.infer([queryPrefix + clipped]);
    if (!vector) throw new Error("Workers AI returned no query embedding");
    return vector;
  }

  embedDocument(text: string): Promise<Float32Array[]> {
    return this.infer(
      documentChunks(text).map((chunk) => documentPrefix + chunk),
    );
  }
}
