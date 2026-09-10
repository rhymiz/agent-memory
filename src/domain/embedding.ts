export interface EmbeddingModel {
  readonly id: string;
  readonly dimensions: number;
  embedQuery(text: string): Promise<Float32Array>;
  embedDocument(text: string): Promise<Float32Array[]>;
}

export function normalized(
  vector: Float32Array,
  dimensions: number,
): Float32Array {
  if (vector.length !== dimensions || !vector.every(Number.isFinite))
    throw new Error("Invalid embedding dimensions or values");
  const magnitude = Math.hypot(...vector);
  if (magnitude === 0) throw new Error("Embedding must have nonzero magnitude");
  return vector.map((value) => value / magnitude);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length)
    throw new Error("Embedding dimensions do not match");
  let score = 0;
  for (let i = 0; i < a.length; i++) score += a[i]! * b[i]!;
  return score;
}
