// Runs the on-device language model (WebLLM / WebGPU) off the main thread.
import { WebWorkerMLCEngineHandler } from '../../../lib/web-llm/index.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
