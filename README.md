# 渠道价格采集目录

Node.js 本地数据接入项目。来源服务和业务存储独立，来源变化不会自动刷新本地集合。采集在原有“最新报价集合”之外，额外保存只追加的**观察（observation）**与**已发布比较（comparison）**：来源明示的价格组成、币种与观察时间原样保留，`null` 始终表示“来源未写”而非零；带生效范围的规则把报价换算成可比口径，口径不足时给出原因而不是补默认零运费。

## 运行

需要 Node.js 22，无第三方包、远程服务或账户凭据。`npm test` 运行现有行为与本地接口测试；`npm run demo` 启动临时来源、读取首批与改版页面、登记规则、发布比较并演示显式重算，结束时自动关闭监听并清理临时数据，通常两秒内完成。`npm run acceptance` 在临时目录中验证完整生命周期（采集、重启回读、重放、规则升级、不可比解释、重算与历史追溯）。演示数据不访问生产站点。

## 命令

`npm start` 或 `npm start -- --help` 查看命令。所有命令可用 `--state 目录` 指向独立状态目录（默认 `var/`）。

- `ingest [文件]`：从来源记录导入，更新最新报价集合，同时追加不可变观察；相同内容重抓命中同一 `observationId`，不产生新版本。
- `query [来源]`：读取本地最新报价集合（既有能力保持不变）。
- `rules [文件]`：登记带 `effectiveFrom` 的规则版本；同版本内容再次登记必须一致，否则拒绝（历史规则不可变）。
- `observe`：列出观察，含来源明示的 `amount/currency/taxIncluded/shipping`、观察时间、来源自带规则版本与原始属性。
- `compare <observationId ...> [--rule-version=版本]`：按观察时间所处的生效规则形成比较；口径不足（税费口径未知、运费未知、金额/币种缺失、组内币种不一致）时整组标记 `incomparable` 并逐行给出原因，不产出可能误导的金额。
- `recalculate <comparisonId> [--rule-version=版本 | --at=时间]`：**明确发起**的重算，按新口径生成新的比较记录，并在旧记录上标记 `supersededBy`；旧记录及其规则快照保留，结论可追溯。
- `comparisons`：列出已发布比较、规则快照与取代关系。

## 组件和数据

`source/server.js` 读取 `fixtures/source.json` 并监听随机回环端口。`startSource()` 返回 url、publish(stage)、failNext(path,status) 和 close()；publish 切换可观察来源版本而不修改业务仓库，failNext 可返回 503 或使用 disconnect 断开连接。它记录请求路径并支持来源 ETag/304。`src/source-client.js` 只接受同一回环来源；`src/adapter.js` 解析页面并保留原始来源属性。

生命周期组件：

- `src/money.js`：定点十进制（BigInt）金额解析、税率计算与四舍五入，金额全程不使用浮点。
- `src/rules.js` / `src/rule-repository.js`：规则校验、按生效范围选版、只追加且不可变的规则注册表。
- `src/observations.js` / `src/observation-builder.js`：观察构建与只追加存储，`observationId` 由来源身份、观察时间与价格组成哈希得到，内容相同则幂等。
- `src/compare.js`：口径引擎，输出含税口径下的到手价组成，或带原因码的不可比解释。
- `src/comparisons.js`：已发布比较的只追加存储与取代链；每条记录引用具体 `observationId` 并固化当时的规则快照。
- `src/service.js`：编排采集、规则登记、比较与显式重算；未注入生命周期存储时退化为原有集合服务。
- `src/operations.js`：业务读取入口，既有 `product/rows` 形状不变，启用生命周期时额外返回 `observations` 与 `comparisons`（含解释信息）。

状态目录（默认 `var/`）属于运行产物：`records.json` 为最新集合，`observations.json`、`comparisons.json`、`rules.json` 为只追加的生命周期状态。规则升级只影响新观察和明确发起的重算；重抓旧页面不会让已发布历史结论无声改变。测试可直接使用随机端口来源，不需要等待真实时间或接入外网。
