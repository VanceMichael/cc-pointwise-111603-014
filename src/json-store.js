import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// 通用 JSON 文档存储：原子替换写盘；读取只在文件缺失时返回缺省值。
export class JsonStore {
  constructor(path, fallback) {
    this.path = path;
    this.fallback = fallback;
  }

  async read() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(this.fallback);
      throw error;
    }
  }

  async write(document) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, this.path);
  }
}
