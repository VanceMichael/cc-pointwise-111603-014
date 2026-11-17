import { createHash } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { canonicalJson } from './money.js';

// 已发布比较是只追加的结论文件：每条都引用具体 observationId，并固化当时选中的规则快照。
// 规则升级、来源重抓都不会改动既有记录；明确发起的重算会生成新记录并标记取代关系。

export function buildComparisonId(parts) {
  return `cmp-${createHash('sha256').update(canonicalJson(parts)).digest('hex').slice(0, 16)}`;
}

function normalizeComparison(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('comparison must be an object');
  }
  const comparison = structuredClone(input);
  for (const field of ['comparisonId', 'kind', 'status', 'publishedAt', 'rule', 'evaluations']) {
    if (comparison[field] === undefined || comparison[field] === null) {
      throw new Error(`missing comparison ${field}`);
    }
  }
  if (!Array.isArray(comparison.evaluations) || comparison.evaluations.length === 0) {
    throw new Error('comparison must contain at least one evaluation');
  }
  comparison.supersedes = Array.isArray(comparison.supersedes) ? comparison.supersedes : [];
  comparison.reason = comparison.reason ?? null;
  comparison.ranking = comparison.ranking ?? null;
  comparison.currency = comparison.currency ?? null;
  return comparison;
}

export class ComparisonRepository {
  constructor(path) { this.store = new JsonStore(path, { comparisons: [] }); }

  async read() {
    const document = await this.store.read();
    if (!Array.isArray(document.comparisons)) throw new Error('comparison file has no comparisons array');
    return structuredClone(document.comparisons);
  }

  async publish(input) {
    const comparison = normalizeComparison(input);
    const stored = await this.read();
    if (stored.some((item) => item.comparisonId === comparison.comparisonId)) {
      return { published: false, comparisonId: comparison.comparisonId };
    }
    await this.store.write({ comparisons: [...stored, comparison] });
    return { published: true, comparisonId: comparison.comparisonId };
  }

  async markSuperseded(ids, successorId, reason) {
    const targets = new Set(ids);
    const stored = await this.read();
    let changed = false;
    const updated = stored.map((item) => {
      if (!targets.has(item.comparisonId)) return item;
      if (item.supersededBy) return item; // 已被取代的历史结论不再二次改写
      changed = true;
      return { ...item, supersededBy: successorId, supersedeReason: reason ?? item.supersedeReason ?? null };
    });
    if (changed) await this.store.write({ comparisons: updated });
    return changed;
  }

  async findLatest(kind, observationIds) {
    const wanted = new Set(observationIds);
    const matches = (await this.read())
      .filter((item) => item.kind === kind
        && item.evaluations.length === observationIds.length
        && item.evaluations.every((evaluation) => wanted.has(evaluation.observationId)))
      .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
    return matches[0] ?? null;
  }
}
