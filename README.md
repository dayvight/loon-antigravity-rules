# loon-antigravity-rules

[![覆盖缺口校验](https://github.com/dayvight/loon-antigravity-rules/actions/workflows/coverage-check.yml/badge.svg)](https://github.com/dayvight/loon-antigravity-rules/actions/workflows/coverage-check.yml)

补 [kelee AI.lsr](https://kelee.one/Tool/Loon/Lsr/AI.lsr) 与 [VPSDance/ai-proxy-rules](https://github.com/VPSDance/ai-proxy-rules) 的覆盖缺口 —— Google 账号 / OAuth 登录链路。

## 解决什么问题

Google Antigravity 登录时会弹出：

> Sorry, this account is ineligible to use Antigravity
> Your current account is not eligible for Antigravity, because it is not currently available in your location.

排查下来有两道门：出口 IP 地区、以及账号在 Google 侧记录的国家。**第一道门的根因往往不是节点选错，而是规则集没覆盖登录域名。**

主流 AI 规则集的定位是「AI 产品域名」，Antigravity 本体（`antigravity.google`、`cloudcode-pa.googleapis.com`）会被收进去，但登录必经的 `accounts.google.com` 不在其中 —— 因为那属于 Google 通用账号服务，不属于 AI 产品。

于是出现这种情况：Antigravity 进程走代理，登录请求却落到兜底的另一个节点，Google 拿到的源 IP 在非支持地区，直接拒绝。

## 实测覆盖率

对两份规则集做了集合比对（域名规则数：kelee AI.lsr 242 条 / VPSDance global.list 327 条）：

| | kelee AI.lsr | VPSDance global.list |
|---|---|---|
| 相互覆盖 | — | 92 / 242（38%） |
| 无法覆盖 | **150 条** | 281 条 |

`global.list` 覆盖不到 `AI.lsr` 的 150 条，绝大多数是中小推理平台的 API 端点（302.ai、Moonshot、Kimi、StepFun、SiliconFlow、Nebius、Modal、Scaleway…），Google 相关只差 2 条。**两者是互补关系，不是替代关系。**

而 Antigravity 登录链路的 24 个关键域名里，两份规则集都缺的这 15 个，就是本仓库要补的部分：

| 域名 | AI.lsr | global.list |
|---|---|---|
| `accounts.google.com` | ❌ | ❌ |
| `myaccount.google.com` | ❌ | ❌ |
| `ogs.google.com` | ❌ | ❌ |
| `apis.google.com` | ❌ | ❌ |
| `clients6.google.com` | ❌ | ❌ |
| `content-autofill.googleapis.com` | ❌ | ❌ |
| `oauth2.googleapis.com` | ❌ | ❌ |
| `www.googleapis.com` | ❌ | ❌ |
| `aiplatform.googleapis.com` | ✅ | ❌ |
| `daily-cloudcode-pa.sandbox.googleapis.com` | ✅ | ❌ |
| `lh3.googleusercontent.com` | ❌ | ❌ |
| `ssl.gstatic.com` | ❌ | ❌ |
| `www.google.com` | ❌ | ❌ |
| `play.google.com` | ❌ | ❌ |
| `mail.google.com` | ❌ | ❌ |

## 两个文件怎么选

### `rules/google-auth.list` —— 精确版（推荐先试）

只补上表 15 个缺口，接在 AI 规则集后面。影响面最小，Gmail / Play / YouTube 不受影响。

```ini
[Remote Rule]
https://raw.githubusercontent.com/dayvight/loon-antigravity-rules/main/rules/google-auth.list, policy=AI 手动, tag=Google-Auth, enabled=true
```

### `rules/google-full.list` —— 全域兜底版

7 条后缀接管整个 Google 生态。Google 以后新增任何域名都不会再漏，代价是 Gmail / Play / YouTube 全部流量也走代理。

```ini
[Remote Rule]
https://raw.githubusercontent.com/dayvight/loon-antigravity-rules/main/rules/google-full.list, policy=AI 手动, tag=Google, enabled=true
```

### jsDelivr 镜像（国内拉取更稳）

```
https://cdn.jsdelivr.net/gh/dayvight/loon-antigravity-rules@main/rules/google-auth.list
https://cdn.jsdelivr.net/gh/dayvight/loon-antigravity-rules@main/rules/google-full.list
```

## 放置位置

规则顺序很关键，两条硬要求：

1. **放在 `FINAL` 之前**，否则不会命中；
2. **放在 CN 区域分流规则之后**（`GEOIP,cn,DIRECT`、`REGION_SPLITTER` 之类），否则国内域名会被误拉进代理。

Loon 的实际匹配顺序：本地 `[Rule]` → `[Remote Rule]` → `FINAL`。远程规则的引入顺序就是匹配顺序。

## 注意事项

- **文中的 `policy` 值必须换成你自己的策略组名**，直接抄 `AI 手动` 大概率跑不通。
- 规则集本身不带 policy，policy 由引用时指定，这是 Loon 远程规则的机制。
- 补完规则还不够 —— Google 侧还有一道「账号关联国家」的门（`policies.google.com/terms` 页面顶部的国家/地区版本）。出口已正确但登录仍被拒时，那道门只能通过 [country-association-form](https://policies.google.com/country-association-form) 或换账号解决，改规则无效。
- `PROCESS-NAME,Antigravity` 在 macOS 上通常不命中，Electron 应用真正发起网络请求的是 `Antigravity Helper` 子进程，所以本规则集不使用进程规则。

## 验证

改完配置重载后：

```bash
# 未登录状态下，Google 按 IP 返回条款地区版本
curl -s "https://policies.google.com/terms?hl=en" | grep -oE '(United States|Hong Kong|China)' | sort | uniq -c
```

返回 `United States` 说明该域名的出口已被 Google 判定为美国。

## 自动校验

`.github/workflows/coverage-check.yml` 每天 UTC 02:00（北京时间 10:00）运行一次：

1. 拉取两份上游规则集最新版本，写入 `upstream/*.list` 快照
2. 用 24 个关键域名逐一检查是否被「上游规则 + 本仓库补充规则」覆盖
3. 发现无人覆盖的域名 → 自动开 issue（标题前缀 `[coverage-gap]`；已存在则更新内容，不会每天刷屏）
4. 上游快照有变化 → 自动提交

### 关于 kelee 源的 Cloudflare 拦截

`kelee.one` 与 `rule.kelee.one` 对数据中心 IP 返回 **HTTP 403**（Cloudflare 拦截），GitHub Actions 的 runner 同样命中。所以脚本内置快照回退：

- 拉取失败时使用 `upstream/kelee-ai.list`，不会把「读不到」误报成「没覆盖」
- 快照更新方式：本机 Loon 刷新过规则后，从缓存复制

```bash
cp ~/Library/Application\ Support/com.loon.Loon/remoteRule/<hash>.lsr upstream/kelee-ai.list
```

### 本地手动跑

```bash
DRY_RUN=1 node scripts/check-coverage.mjs
```

输出会同时写入 GitHub Actions 的 Job Summary。

## License


MIT
