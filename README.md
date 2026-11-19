# 渠道价格采集目录

Node.js 本地数据接入项目。已有一次来源读取、结构化导入与操作查询，来源服务和业务存储独立，来源变化不会自动刷新本地集合。导入以 sourceId 保存最新观察，同时把每次观察追加进只增不改的观察日志；完整批次、身份决策及恢复流程尚未纳入接入生命周期。

## 运行

需要 Node.js 22，无第三方包、远程服务或账户凭据。`npm test` 运行现有行为与本地接口测试；`npm run demo` 启动临时来源，演示首批采集、发布比较、来源改版后的口径解释、明确重算与重抓旧页面，结束时自动关闭监听并清理临时数据，通常两秒内完成。`npm start -- ingest` 从 `fixtures/records.json` 导入，`npm start -- query` 读取本地 `var/records.json`。演示数据不访问生产站点。

## 组件和数据

`source/server.js` 读取 `fixtures/source.json` 并监听随机回环端口。`startSource()` 返回 url、publish(stage)、failNext(path,status) 和 close()；publish 切换可观察来源版本而不修改业务仓库，failNext 可返回 503 或使用 disconnect 断开连接。它记录请求路径并支持来源 ETag/304。`src/source-client.js` 只接受同一回环来源；`src/adapter.js` 解析现有首批页面并保留原始来源属性，返回 records 和 next；目前 demo 只导入首批。`src/service.js` 与 `src/repository.js` 维护持久集合；`src/operations.js` 是读取该集合的业务消费入口，来源协议见 [CONTRACT.md](CONTRACT.md)。

比价生命周期新增以下组件：

- `src/observations.js` 与 `src/observation-log.js`：观察日志（`var/observations.json`），按 `sourceId#observedAt` 留存来源明示的金额、税费口径、运费、币种与观察时间。追加幂等，重放不重复；同键内容不一致记为冲突并保留原观察，绝不静默改写。
- `src/rules.js` 与 `src/rule-book.js`：带生效范围的规则（默认 `fixtures/rules.json`，可用环境变量 `PRICE_RULES` 指向其他规则文件）。规则升级只能追加新版本；每条观察按自己的观察时间解析适用规则。
- `src/compare.js` 与 `src/comparison-service.js`：把同一 sku 的最新观察口径化为可比的“到手价”（金额 + 未含税时的税额 + 运费，十进制精确计算）。来源组成不足的报价不参与直接比较，并给出原因（如税费口径未知、运费未知），不会补默认零运费。
- `src/comparison-store.js`：已发布比较（`var/comparisons.json`）不可变，内嵌原报价引用与当时规则快照。`compare` 只生成候选结果；`publish` 发布；`recompute` 是明确发起的重算，生成新版本并通过 supersedes 关联历史版本。采集与规则变化都不会改写已发布结论。

状态目录属于运行产物。扩展导入时应保留现有 CLI 和现有集合查询能力；新增状态可以另行组织。测试可直接使用随机端口来源，不需要等待真实时间或接入外网。运行录制可用 test 和 demo，无需安装浏览器或外部数据库。

`npm start` 或 `npm start -- --help` 查看命令；原导入和查询使用显式的 ingest、query 动作，比价使用 observations、compare、publish、recompute、comparisons 动作。`npm run acceptance` 在临时目录中验证本地来源读取、首批导入、重启回读、重放幂等、发布比较、口径不足解释、明确重算与重抓旧页面不改变历史结论，完成后清理临时状态。

既有 `var/records.json` 不含观察历史；重新执行一次 ingest 即可把当前集合回填进观察日志。
