const fields = ["offerId", "shop", "sku", "amount", "currency", "taxIncluded", "shipping", "observedAt", "ruleVersion"];

export async function readOperations(repository) {
  const records = await repository.read();
  return { product: "渠道价格采集目录", rows: records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  })) };
}
