// The real embedder: bge-small-en-v1.5, quantized (q8), run in-process on the CPU with onnxruntime-node
// and tokenized by @huggingface/tokenizers (docs/adr/0026-the-embedding-model-is-pinned-by-a-lock-file-and-run-with-onnxruntime-node.md).
// The ingest worker and the server each make one in their entry script from MODEL_PATH and the committed
// lock file, the way they make the clock.
export { loadOnnxEmbedder, type OnnxEmbedderOptions } from "./lib/onnx.ts";
