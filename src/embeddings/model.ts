import { Tokenizer } from "@huggingface/tokenizers";
import { InferenceSession, Tensor } from "onnxruntime-node";
import { z } from "zod";
import { normalized, type EmbeddingModel } from "../domain/embedding";
import { runtimeFile } from "./assets";
import { model } from "./manifest";

const queryPrefix = "task: search result | query: ";
const documentPrefix = "title: none | text: ";

export class LocalEmbeddingModel implements EmbeddingModel {
  readonly id = model.id;
  readonly dimensions = model.dimensions;
  private pending: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly tokenizer: Tokenizer,
    private readonly session: InferenceSession,
  ) {}

  static async load(): Promise<LocalEmbeddingModel> {
    const tokenizerData: unknown = await Bun.file(
      runtimeFile("tokenizer.json"),
    ).json();
    const configData: unknown = await Bun.file(
      runtimeFile("tokenizer_config.json"),
    ).json();
    // Assets are SHA-256 verified; validate the JSON boundary before handing it to the library.
    const object = z.record(z.string(), z.unknown());
    const tokenizer = new Tokenizer(
      object.parse(tokenizerData),
      object.parse(configData),
    );
    const session = await InferenceSession.create(
      runtimeFile("model_quantized.onnx"),
      {
        executionProviders: ["cpu"],
        intraOpNumThreads: 2,
        interOpNumThreads: 1,
      },
    );
    return new LocalEmbeddingModel(tokenizer, session);
  }

  private infer(text: string): Promise<Float32Array> {
    const run = this.pending.then(async () => {
      const encoding = this.tokenizer.encode(text);
      if (encoding.ids.length > 2048)
        throw new Error("Embedding input exceeds model context");
      const shape = [1, encoding.ids.length];
      const output = await this.session.run(
        {
          input_ids: new Tensor(
            "int64",
            BigInt64Array.from(encoding.ids, BigInt),
            shape,
          ),
          attention_mask: new Tensor(
            "int64",
            BigInt64Array.from(encoding.attention_mask, BigInt),
            shape,
          ),
        },
        ["sentence_embedding"],
      );
      const embedding = output.sentence_embedding;
      if (
        !embedding ||
        embedding.type !== "float32" ||
        !(embedding.data instanceof Float32Array)
      )
        throw new Error("Model did not return a float32 sentence embedding");
      return normalized(embedding.data, this.dimensions);
    });
    this.pending = run.catch(() => {});
    return run;
  }

  embedQuery(text: string): Promise<Float32Array> {
    return this.infer(queryPrefix + text);
  }

  async embedDocument(text: string): Promise<Float32Array[]> {
    const chunks = new Set<string>();
    let shortParagraphs: string[] = [];
    let shortTokens = 0;
    const flush = () => {
      if (shortParagraphs.length) chunks.add(shortParagraphs.join("\n\n"));
      shortParagraphs = [];
      shortTokens = 0;
    };
    for (const paragraph of text
      .split(/\n\s*\n/u)
      .filter((part) => part.trim())) {
      const ids = this.tokenizer.encode(paragraph, {
        add_special_tokens: false,
      }).ids;
      // Keep meaningful paragraph boundaries; group tiny paragraphs to bound inference work.
      if (ids.length < 128) {
        shortParagraphs.push(paragraph);
        shortTokens += ids.length;
        if (shortTokens >= 128) flush();
        continue;
      }
      flush();
      for (
        let start = 0;
        start < ids.length;
        start += model.chunkTokens - model.overlapTokens
      ) {
        chunks.add(
          this.tokenizer.decode(ids.slice(start, start + model.chunkTokens), {
            skip_special_tokens: false,
          }),
        );
        if (start + model.chunkTokens >= ids.length) break;
      }
    }
    flush();
    const vectors: Float32Array[] = [];
    for (const chunk of chunks) {
      vectors.push(await this.infer(documentPrefix + chunk));
    }
    if (!vectors.length) vectors.push(await this.infer(documentPrefix + text));
    return vectors;
  }

  async close(): Promise<void> {
    await this.pending;
    await this.session.release();
  }
}
