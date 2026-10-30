// An embedder over a runner of your choice: the model's own tokenizer, from the model directory, and a
// `ModelRunner` that stands for the ONNX session. The real embedder (`onnx.ts`) is this with the real session;
// a test's fake is this with a fake one, so that the fake and the real model see the same passages.
export { loadEmbedder } from "./lib/load.ts";
