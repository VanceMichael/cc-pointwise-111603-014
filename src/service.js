import { findRecords, mergeRecords, normalizeRecord } from './records.js';
import { observationFromRecord } from './observation-builder.js';
import { selectRule } from './rules.js';
import { compareObservations } from './compare.js';
import { buildComparisonId } from './comparisons.js';

// 采集与比价生命周期服务。
// 观察只追加、历史比较只追加；规则升级只影响新观察和“明确发起的重算”，
// 已发布结论引用的 observationId 与规则快照使其可脱离当前规则被追溯。
export class CollectionService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.observations = options.observations ?? null;
    this.comparisons = options.comparisons ?? null;
    this.ruleRegistry = options.ruleRegistry ?? null;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  get lifecycleEnabled() {
    return Boolean(this.observations && this.comparisons && this.ruleRegistry);
  }

  async ingest(inputs) {
    if (!Array.isArray(inputs)) throw new TypeError('ingest input must be an array');
    const now = this.clock();
    const accepted = inputs.map(normalizeRecord);
    const current = await this.repository.read();
    const merged = mergeRecords(current, accepted);
    await this.repository.replace(merged);
    const result = { accepted: accepted.length, stored: merged.length };

    if (this.lifecycleEnabled && accepted.length) {
      const observations = accepted.map((record) => observationFromRecord(record, now));
      result.observations = await this.observations.append(observations);
    }
    return result;
  }

  async query(filters) { return findRecords(await this.repository.read(), filters); }

  async registerRules(inputs) {
    this.#requireLifecycle();
    return this.ruleRegistry.register(inputs);
  }

  #requireLifecycle() {
    if (!this.lifecycleEnabled) {
      throw new Error('lifecycle storage is not configured for this service');
    }
  }

  #resolveRules() { return this.ruleRegistry.repository.read(); }

  async listObservations() {
    this.#requireLifecycle();
    return this.observations.read();
  }

  async listComparisons() {
    this.#requireLifecycle();
    return this.comparisons.read();
  }

  // 新观察首次参与比较：按观察时间选择生效规则（新观察自然采用新口径）。
  async compare(observationIds, { ruleVersion } = {}) {
    this.#requireLifecycle();
    const observations = await this.observations.byIds(observationIds);
    if (observations.length !== observationIds.length) {
      const known = new Set(observations.map((item) => item.observationId));
      const missing = observationIds.filter((id) => !known.has(id));
      throw new Error(`unknown observations: ${missing.join(', ')}`);
    }
    const rules = await this.#resolveRules();
    const referenceAt = observations.map((item) => item.observedAt).sort()[0];
    const rule = selectRule(rules, { at: referenceAt, version: ruleVersion });
    const result = compareObservations(observations, rule);
    const now = this.clock();
    const comparisonId = buildComparisonId({
      kind: 'compare',
      observations: observations.map((item) => item.observationId),
      rule: result.rule,
    });
    const comparison = {
      comparisonId,
      kind: 'compare',
      status: result.status,
      publishedAt: now,
      rule: result.rule,
      currency: result.currency,
      evaluations: result.evaluations,
      ranking: result.ranking,
      observationIds: observations.map((item) => item.observationId),
    };
    const outcome = await this.comparisons.publish(comparison);
    return { ...outcome, comparison, evaluations: result.evaluations, ranking: result.ranking, status: result.status };
  }

  // 明确发起的重算：允许指定新规则版本（或按重算时刻选版），生成新结论并取代旧结论。
  async recalculate(previousComparisonId, { ruleVersion, at } = {}) {
    this.#requireLifecycle();
    const history = await this.comparisons.read();
    const previous = history.find((item) => item.comparisonId === previousComparisonId);
    if (!previous) throw new Error(`unknown comparison: ${previousComparisonId}`);

    const observations = await this.observations.byIds(previous.observationIds);
    if (observations.length !== previous.observationIds.length) {
      throw new Error('original observations are no longer available for recalculation');
    }
    const rules = await this.#resolveRules();
    const rule = selectRule(rules, { at: at ?? this.clock(), version: ruleVersion });
    const result = compareObservations(observations, rule);
    const now = this.clock();
    const comparisonId = buildComparisonId({
      kind: 'recalculation',
      supersedes: previousComparisonId,
      observations: observations.map((item) => item.observationId),
      rule: result.rule,
      publishedAt: now,
    });
    const comparison = {
      comparisonId,
      kind: 'recalculation',
      status: result.status,
      publishedAt: now,
      rule: result.rule,
      currency: result.currency,
      evaluations: result.evaluations,
      ranking: result.ranking,
      observationIds: observations.map((item) => item.observationId),
      supersedes: [previousComparisonId],
    };
    const outcome = await this.comparisons.publish(comparison);
    if (outcome.published) {
      await this.comparisons.markSuperseded([previousComparisonId], comparisonId,
        'explicit recalculation under a new rule caliber');
    }
    return { ...outcome, comparison, evaluations: result.evaluations, ranking: result.ranking, status: result.status };
  }
}
