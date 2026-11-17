// 转换规则的装载、生效范围选择与不可变注册表。
// 规则带 effectiveFrom（含当日生效），版本内容一旦进入注册表就不允许被替换。

export const RULE_FIELDS = Object.freeze(['version', 'effectiveFrom', 'taxRate']);

export function normalizeRule(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('rule must be an object');
  }
  const rule = {
    version: String(input.version ?? '').trim(),
    effectiveFrom: String(input.effectiveFrom ?? '').trim(),
    taxRate: String(input.taxRate ?? '').trim(),
  };
  for (const field of RULE_FIELDS) {
    if (!rule[field]) throw new Error(`missing rule ${field}`);
  }
  if (!Number.isFinite(Date.parse(rule.effectiveFrom))) {
    throw new Error(`invalid rule effectiveFrom for ${rule.version}`);
  }
  // 校验税率是合法十进制字符串；parseDecimal 会拒绝空串与非数字。
  // 延迟引入避免模块初始化顺序问题。
  return rule;
}

export function loadRules(inputs) {
  if (!Array.isArray(inputs)) throw new TypeError('rules must be an array');
  const seen = new Set();
  const rules = inputs.map((input) => {
    const rule = normalizeRule(input);
    if (seen.has(rule.version)) throw new Error(`duplicate rule version: ${rule.version}`);
    seen.add(rule.version);
    return rule;
  });
  return rules.sort((left, right) => {
    const byDate = Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom);
    return byDate !== 0 ? byDate : left.version.localeCompare(right.version);
  });
}

function dayStart(value) {
  const date = new Date(value);
  return Date.parse(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString());
}

// 选择 referenceTime（含）之前最近生效的规则；明确指定版本时直接返回该版本。
export function selectRule(rules, { at, version } = {}) {
  if (version !== undefined && version !== null) {
    const pinned = rules.find((rule) => rule.version === version);
    if (!pinned) throw new Error(`unknown rule version: ${version}`);
    return pinned;
  }
  const reference = dayStart(at);
  const candidates = rules
    .filter((rule) => dayStart(rule.effectiveFrom) <= reference)
    .sort((left, right) => {
      const byDate = Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom);
      return byDate !== 0 ? byDate : right.version.localeCompare(left.version);
    });
  if (!candidates.length) {
    throw new Error(`no rule is effective at ${new Date(at).toISOString()}`);
  }
  return candidates[0];
}

// 只追加的规则注册表：同版本再次登记时，内容必须逐字段一致，否则视为篡改并拒绝。
export class RuleRegistry {
  constructor(repository) { this.repository = repository; }

  async register(inputs) {
    const incoming = loadRules(inputs);
    const stored = await this.repository.read();
    const byVersion = new Map(stored.map((rule) => [rule.version, rule]));
    const added = [];
    for (const rule of incoming) {
      const existing = byVersion.get(rule.version);
      if (existing) {
        if (existing.effectiveFrom !== rule.effectiveFrom || existing.taxRate !== rule.taxRate) {
          throw new Error(`rule ${rule.version} is already registered with different content; historical rules are immutable`);
        }
        continue;
      }
      byVersion.set(rule.version, rule);
      added.push(rule);
    }
    if (added.length) {
      const merged = [...byVersion.values()].sort((left, right) => {
        const byDate = Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom);
        return byDate !== 0 ? byDate : left.version.localeCompare(right.version);
      });
      await this.repository.replace(merged);
    }
    return { registered: added.length, total: byVersion.size };
  }
}

// 比较结果中固化的规则快照：历史结论必须能脱离“当前规则文件”重建口径。
export function ruleSnapshot(rule) {
  return {
    version: rule.version,
    effectiveFrom: rule.effectiveFrom,
    taxRate: rule.taxRate,
  };
}
