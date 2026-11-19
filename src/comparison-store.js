import { readJson, writeJsonAtomic } from './json-file.js';

// 已发布比较存储：发布后不可变。重算只追加新版本并通过 supersedes 关联，
// 采集与规则变化都不会改写已发布内容。
export class ComparisonStore {
  constructor(path) { this.path = path; }

  async read() {
    const state = await readJson(this.path, { comparisons: [] });
    if (!Array.isArray(state.comparisons)) throw new Error('comparison store has no comparisons array');
    return state.comparisons;
  }

  async get(id) {
    return (await this.read()).find((comparison) => comparison.id === id) ?? null;
  }

  async publish(candidate, { now, supersedes = null }) {
    const comparisons = await this.read();
    const id = `cmp-${String(comparisons.length + 1).padStart(4, '0')}`;
    const published = {
      id,
      status: 'published',
      publishedAt: now,
      supersedes,
      ...structuredClone(candidate),
    };
    await writeJsonAtomic(this.path, { comparisons: [...comparisons, published] });
    return published;
  }
}
