import { createHash } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { canonicalJson } from './money.js';

// 观察是来源页面的只读事实：同一来源身份与同一观察时间、同一价格口径只产生一条观察。
// 重新抓取到相同内容时命中同一 observationId（幂等），不会产生新版本，也不会改动历史。
export function buildObservationId(parts) {
  return `obs-${createHash('sha256').update(canonicalJson(parts)).digest('hex').slice(0, 16)}`;
}

function normalizeObservation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('observation must be an object');
  }
  const price = input.price && typeof input.price === 'object' && !Array.isArray(input.price)
    ? structuredClone(input.price) : {};
  const observation = {
    observationId: String(input.observationId ?? '').trim(),
    sourceId: String(input.sourceId ?? '').trim(),
    source: String(input.source ?? '').trim(),
    sku: String(input.sku ?? '').trim(),
    shop: input.shop === undefined || input.shop === null ? null : String(input.shop),
    observedAt: String(input.observedAt ?? '').trim(),
    ingestedAt: String(input.ingestedAt ?? '').trim(),
    price: {
      amount: typeof price.amount === 'string' ? price.amount : null,
      currency: typeof price.currency === 'string' ? price.currency : null,
      taxIncluded: price.taxIncluded === true || price.taxIncluded === false ? price.taxIncluded : null,
      shipping: typeof price.shipping === 'string' ? price.shipping : null,
    },
    sourceRuleVersion: typeof input.sourceRuleVersion === 'string' ? input.sourceRuleVersion : null,
    raw: input.raw !== undefined ? structuredClone(input.raw) : null,
  };
  for (const field of ['observationId', 'sourceId', 'source', 'sku', 'observedAt', 'ingestedAt']) {
    if (!observation[field]) throw new Error(`missing observation ${field}`);
  }
  if (!Number.isFinite(Date.parse(observation.observedAt))) throw new Error('invalid observation observedAt');
  if (!Number.isFinite(Date.parse(observation.ingestedAt))) throw new Error('invalid observation ingestedAt');
  return observation;
}

export class ObservationRepository {
  constructor(path) { this.store = new JsonStore(path, { observations: [] }); }

  async read() {
    const document = await this.store.read();
    if (!Array.isArray(document.observations)) throw new Error('observation file has no observations array');
    return structuredClone(document.observations);
  }

  async append(inputs) {
    const incoming = inputs.map(normalizeObservation);
    const stored = await this.read();
    const known = new Set(stored.map((item) => item.observationId));
    const added = [];
    for (const observation of incoming) {
      if (known.has(observation.observationId)) continue;
      known.add(observation.observationId);
      added.push(observation);
    }
    if (added.length) {
      const merged = [...stored, ...added].sort((left, right) => {
        const byTime = Date.parse(left.observedAt) - Date.parse(right.observedAt);
        return byTime !== 0 ? byTime : left.observationId.localeCompare(right.observationId);
      });
      await this.store.write({ observations: merged });
    }
    return { added: added.length, stored: (await this.read()).length, addedIds: added.map((item) => item.observationId) };
  }

  async byIds(ids) {
    const wanted = new Set(ids);
    return (await this.read()).filter((observation) => wanted.has(observation.observationId));
  }
}
