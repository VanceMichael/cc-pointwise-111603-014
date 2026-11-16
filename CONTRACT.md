# 来源与消费契约

## 来源

入口 `/prices/shop-a`，HTML 内的 source-record JSON 节点保留了门户输出字段；rel=next 链接表示下一页。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

金额为十进制字符串，currency/taxIncluded/shipping 是来源明示口径，null 表示未知而非零。fixtures/rules.json 为带有效期的转换规则；相同 sku 不意味着不同计价口径可比较。已发布比较引用 observation 与 ruleVersion，不受当前规则替换而隐式重算。

## 业务消费

`readOperations(repository)` 当前返回 product 和 rows，每行带 sourceId/source/observedAt/attributes。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。
