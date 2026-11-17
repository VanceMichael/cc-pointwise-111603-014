import { JsonStore } from './json-store.js';

// 规则仓库：规则内容按版本只追加保存，读取返回结构化克隆避免外部就地修改。
export class RuleRepository {
  constructor(path) { this.store = new JsonStore(path, { rules: [] }); }

  async read() {
    const document = await this.store.read();
    if (!Array.isArray(document.rules)) throw new Error('rule file has no rules array');
    return structuredClone(document.rules);
  }

  async replace(rules) { await this.store.write({ rules }); }
}
