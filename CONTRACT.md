# 来源与消费契约

## 来源

入口 `/prices/shop-a`，HTML 内的 source-record JSON 节点保留了门户输出字段；rel=next 链接表示下一页。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

金额为十进制字符串，currency/taxIncluded/shipping 是来源明示口径，null 表示未知而非零；来源明示的 "0.00" 运费是口径声明，与未知运费严格区分。fixtures/rules.json 为带有效期的转换规则；相同 sku 不意味着不同计价口径可比较。已发布比较引用 observation 与 ruleVersion，不受当前规则替换而隐式重算。

## 观察日志

每次导入把记录追加进观察日志（`var/observations.json`），键为 `sourceId#observedAt`。日志只增不改：同一键内容一致的重放是幂等的；内容不一致记为冲突（保留原观察，冲突双方留痕）；较旧的观察作为历史保留，不覆盖较新的。观察完整保留来源明示的价格组成、币种与观察时间，未写明的组成保持未知。

## 可比结果

比较按 sku 分组，每个 sourceId 取最新观察，逐条按观察时间解析生效规则（effectiveFrom 起至下一版本生效前）。到手价口径（definition.version = landed-1）：金额 + 未含税时按规则税率计算的税额 + 运费，十进制精确计算，半进位保留两位。来源组成不足的报价不补默认值（运费未知不等于零运费），标记为不可直接比较并逐条给出原因（amount/currency/tax/shipping 缺失或非法、观察时间无生效规则等）。组内币种不一致时不给出最优结论。

## 发布与重算

`compare` 生成候选结果，不落库；`publish` 把候选结果发布为不可变结论，内嵌每条报价的观察引用、来源明示输入与当时规则快照（version/effectiveFrom/taxRate）及口径定义；`recompute` 是明确发起的重算，用当前观察与当前规则生成新版本并通过 supersedes 关联历史版本。规则升级后，新观察自然按新生效的规则解析；已发布比较不因采集、规则替换或重抓旧页面而改变，历史结论始终能追到原报价与当时的规则。

## 业务消费

`readOperations(repository)` 返回 product 和 rows，每行带 sourceId/source/observedAt/attributes；传入观察日志与比较存储后，同时返回 observations 摘要（total/bySourceId/conflicts）与 comparisons（已发布比较及解释信息）。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。
