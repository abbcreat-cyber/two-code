import { PiAdapter } from "./pi.js";

/** Step使用自己的exe、原生扩展依赖与配置根；仅复用共同的JSONL RPC解析器。 */
export class StepCodeAdapter extends PiAdapter {
  constructor() {
    super("step-code");
  }
}
