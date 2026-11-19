// 观察日志：每次采集按 sourceId#observedAt 留存来源当时明示的内容。
// 只增不改；同一键内容一致的重放是幂等的，内容不一致记为冲突并保留原观察。
export const COMPONENT_FIELDS = Object.freeze(['amount', 'currency', 'taxIncluded', 'shipping']);

export function observationKey(record) {
  return `${record.sourceId}#${record.observedAt}`;
}

export function observationFromRecord(record, ingestedAt) {
  const attributes = structuredClone(record.attributes ?? {});
  const components = {};
  for (const field of COMPONENT_FIELDS) components[field] = attributes[field] ?? null;
  return {
    key: observationKey(record),
    sourceId: record.sourceId,
    observedAt: record.observedAt,
    source: record.source,
    label: record.label,
    components,
    attributes,
    ingestedAt,
  };
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function contentOf(observation) {
  const { key, ingestedAt, ...content } = observation;
  return stableStringify(content);
}

export function appendObservations(existing, incoming) {
  const byKey = new Map(existing.map((observation) => [observation.key, observation]));
  const added = [];
  const conflicts = [];
  for (const observation of incoming) {
    const current = byKey.get(observation.key);
    if (!current) {
      byKey.set(observation.key, observation);
      added.push(observation);
      continue;
    }
    if (contentOf(current) !== contentOf(observation)) {
      // 重抓到的同一观察内容不同：保留原观察，冲突留痕，绝不静默改写历史。
      conflicts.push({ key: observation.key, kept: current, rejected: observation });
    }
  }
  const observations = [...byKey.values()].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId) || Date.parse(left.observedAt) - Date.parse(right.observedAt));
  return { observations, added, conflicts };
}
