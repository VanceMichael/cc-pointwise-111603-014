const fields = ["offerId", "shop", "sku", "amount", "currency", "taxIncluded", "shipping", "observedAt", "ruleVersion"];

// 业务读取入口：rows 保持现有集合视图；observations 与 comparisons 是新增的
// 采集生命周期状态，已发布比较内嵌原报价引用与当时规则快照，解释信息随结果返回。
export async function readOperations(repository, { observations, comparisons } = {}) {
  const records = await repository.read();
  return {
    product: "渠道价格采集目录",
    rows: records.map((record) => ({
      sourceId: record.sourceId,
      source: record.source,
      observedAt: record.observedAt,
      attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
    })),
    observations: observations ? await observations.summary() : { total: 0, bySourceId: {}, conflicts: 0 },
    comparisons: comparisons ? await comparisons.read() : [],
  };
}
