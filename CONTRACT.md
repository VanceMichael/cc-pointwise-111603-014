# 来源与消费契约

## 来源

入口 `/prices/shop-a`，HTML 内的 source-record JSON 节点保留了门户输出字段；rel=next 链接表示下一页。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

金额为十进制字符串，currency/taxIncluded/shipping 是来源明示口径，null 表示未知而非零。采集端必须原样保留这些字段，不允许把缺失运费或未知税费口径补成默认零值。相同 sku 不意味着不同计价口径可比较。

## 规则

`fixtures/rules.json` 为带有效期的转换规则，每条含 `version`、`effectiveFrom`（含当日生效）与 `taxRate`（十进制字符串）。规则按引用时间选择“当时最近生效”的版本，也可在明确发起的操作中指定版本。规则版本一旦登记即不可变：同版本再次登记时内容必须逐字段一致，否则拒绝；新口径以新版本追加。

## 观察与比较

每次导入把来源记录转成只追加的观察，保留来源明示价格组成、币种、观察时间、来源自带 ruleVersion 与原始属性。`observationId` 由来源身份、观察时间与价格组成哈希得到；相同内容重抓命中同一标识，不产生新版本，也不改写既有观察与结论。

比较在观察时间所处的生效规则下进行，输出含税口径的金额组成（挂牌价、税额、含税金额、明示运费、到手价）与规则快照；金额计算使用定点十进制。存在以下任一情况时结果为 `incomparable` 且必须给出原因码，不输出可比金额：来源未给金额（`AMOUNT_MISSING`）、未给币种（`CURRENCY_MISSING`）、税费口径未知（`TAX_SCOPE_UNKNOWN`）、运费未知（`SHIPPING_UNKNOWN`，不得默认零运费）、组内币种不一致且无汇率规则（`GROUP_CURRENCY_MISMATCH`）。

已发布比较引用 observationId 与 ruleVersion，并固化规则快照，不受当前规则替换而隐式重算。只有新观察的首次比较和**明确发起的重算**（`recalculate`，可指定新规则版本或重算时间）可以采用新口径；重算生成新记录并在旧记录上标记 `supersededBy`，旧记录保留可追溯。重抓旧页面不能让历史结论无声改变。

## 业务消费

`readOperations(repository, options)` 返回 product 和 rows，每行带 sourceId/source/observedAt/attributes；注入生命周期存储时额外返回 observations 与 comparisons（含不可比解释与取代关系）。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。
