export const model = {
  repository: "onnx-community/embeddinggemma-300m-ONNX",
  revision: "5090578d9565bb06545b4552f76e6bc2c93e4a66",
  dimensions: 768,
  chunkTokens: 384,
  overlapTokens: 48,
  // Includes the prompt, tokenization and chunking contract, not just the weights.
  id: "embeddinggemma-300m:5090578:q8:768:384:48:paragraphs-v1",
} as const;

export const modelFiles = [
  {
    name: "model_quantized.onnx",
    remote: "onnx/model_quantized.onnx",
    sha256: "172efde319fe1542dc41f31be6154910b05b78f7a861c265c4600eec906bd6d8",
  },
  {
    name: "model_quantized.onnx_data",
    remote: "onnx/model_quantized.onnx_data",
    sha256: "705626e28e4c23c82ade34566b4197d97f534c12275fa406dfb71e9937d388c0",
  },
  {
    name: "tokenizer.json",
    remote: "tokenizer.json",
    sha256: "4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47",
  },
  {
    name: "tokenizer_config.json",
    remote: "tokenizer_config.json",
    sha256: "3ca953eea6c3c9fcda9cf3df22949ff18b216f7c74bd6459230f3f1013953f3a",
  },
];
