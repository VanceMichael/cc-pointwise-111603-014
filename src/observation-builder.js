import { buildObservationId } from './observations.js';

// 把适配层的来源记录转成“观察事实”。来源明示口径原样保留：
// 金额/币种/是否含税/运费均不做默认值填充，null 持续表示来源未写。
export function observationFromRecord(record, now = new Date().toISOString()) {
  const attributes = record.attributes ?? {};
  const price = {
    amount: typeof attributes.amount === 'string' ? attributes.amount : null,
    currency: typeof attributes.currency === 'string' ? attributes.currency : null,
    taxIncluded: attributes.taxIncluded === true || attributes.taxIncluded === false
      ? attributes.taxIncluded : null,
    shipping: typeof attributes.shipping === 'string' ? attributes.shipping : null,
  };
  const observedAt = String(record.observedAt ?? attributes.observedAt ?? '').trim();
  const identity = {
    sourceId: record.sourceId,
    observedAt,
    price,
  };
  return {
    observationId: buildObservationId(identity),
    sourceId: record.sourceId,
    source: record.source,
    sku: String(record.label ?? attributes.sku ?? '').trim(),
    shop: attributes.shop === undefined || attributes.shop === null ? null : String(attributes.shop),
    observedAt,
    ingestedAt: now,
    price,
    sourceRuleVersion: typeof attributes.ruleVersion === 'string' ? attributes.ruleVersion : null,
    raw: structuredClone(attributes),
  };
}
