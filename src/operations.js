const fields = ["offerId", "shop", "sku", "amount", "currency", "taxIncluded", "shipping", "observedAt", "ruleVersion"];

// 业务消费入口：既有 product/rows 形状保持不变；启用生命周期后追加观察与已发布比较，
// 口径不足的解释（reasons）随比较结果一并返回，消费方不需要自行猜测缺失口径。
export async function readOperations(repository, options = {}) {
  const records = await repository.read();
  const view = { product: "渠道价格采集目录", rows: records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  })) };

  if (options.observations) {
    view.observations = await options.observations.read();
  }
  if (options.comparisons) {
    view.comparisons = await options.comparisons.read();
  }
  return view;
}
