// The real embedder: bge-small-en-v1.5, quantized (q8), run in-process on the CPU with onnxruntime-node
// and tokenized by @huggingface/tokenizers (docs/adr/0025). The ingest worker and the server each make
// one in their entry script from MODEL_PATH, the way they make the clock.
export { loadOnnxEmbedder, type OnnxEmbedderOptions } from "./lib/onnx.ts";
