import { isDecimalString } from './decimal.js';

// 规则带生效范围：effectiveFrom 起生效，直到下一条规则生效为止。
// 口径升级只能追加新版本，不能改写已发布版本的内容。
export function normalizeRules(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('rules must be a non-empty array');
  }
  const rules = inputs.map((input) => {
    const version = String(input?.version ?? '').trim();
    if (!version) throw new Error('rule missing version');
    const from = Date.parse(input.effectiveFrom);
    if (!Number.isFinite(from)) throw new Error(`rule ${version} has invalid effectiveFrom`);
    const taxRate = String(input.taxRate ?? '').trim();
    if (!isDecimalString(taxRate)) throw new Error(`rule ${version} has invalid taxRate`);
    return { version, effectiveFrom: new Date(from).toISOString(), taxRate };
  });
  const seen = new Set();
  for (const rule of rules) {
    if (seen.has(rule.version)) throw new Error(`duplicate rule version: ${rule.version}`);
    seen.add(rule.version);
  }
  rules.sort((left, right) => Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom));
  return rules;
}

// 观察时间落在哪条规则的生效范围内，就用哪条规则；之前没有规则则返回 null。
export function ruleForInstant(rules, instant) {
  const time = Date.parse(instant);
  if (!Number.isFinite(time)) throw new Error(`invalid instant: ${instant}`);
  let selected = null;
  for (const rule of rules) {
    if (Date.parse(rule.effectiveFrom) <= time) selected = rule;
    else break;
  }
  return selected;
}

export function effectiveRanges(rules) {
  return rules.map((rule, index) => ({
    version: rule.version,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rules[index + 1]?.effectiveFrom ?? null,
  }));
}
