import { readFile } from 'node:fs/promises';
import { effectiveRanges, normalizeRules } from './rules.js';

// 规则簿：从文件读取当前规则集。规则升级表现为文件追加新版本，
// 每次比较实时读取，已发布比较内嵌当时的规则快照，不依赖当前文件内容。
export class RuleBook {
  constructor(path) { this.path = path; }

  async read() {
    return normalizeRules(JSON.parse(await readFile(this.path, 'utf8')));
  }

  async ranges() {
    return effectiveRanges(await this.read());
  }
}
