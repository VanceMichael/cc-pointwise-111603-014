import { buildComparison } from './compare.js';

// 比较服务：compare 生成候选结果（不落库）；publish 发布为不可变结论；
// recompute 是明确发起的重算，用当前观察与当前规则生成新版本，历史版本保持不变。
export class ComparisonService {
  constructor({ observations, rules, comparisons }) {
    this.observations = observations;
    this.rules = rules;
    this.comparisons = comparisons;
  }

  async compare(sku, { now } = {}) {
    if (!sku) throw new Error('compare requires a sku');
    const [observations, rules] = await Promise.all([this.observations.read(), this.rules.read()]);
    return buildComparison({
      sku,
      observations,
      rules,
      generatedAt: now ?? new Date().toISOString(),
    });
  }

  async publish(sku, { now } = {}) {
    const at = now ?? new Date().toISOString();
    const candidate = await this.compare(sku, { now: at });
    return this.comparisons.publish(candidate, { now: at });
  }

  async recompute(id, { now } = {}) {
    const previous = await this.comparisons.get(id);
    if (!previous) throw new Error(`unknown comparison: ${id}`);
    const at = now ?? new Date().toISOString();
    const candidate = await this.compare(previous.sku, { now: at });
    return this.comparisons.publish(candidate, { now: at, supersedes: id });
  }

  async list() {
    return this.comparisons.read();
  }
}
