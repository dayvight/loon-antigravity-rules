# loon-antigravity-rules

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

### `rules/antigravity-google-auth.list` —— 精确版（推荐先试）

只补上表 15 个缺口，接在 AI 规则集后面。影响面最小，Gmail / Play / YouTube 不受影响。

```ini
[Remote Rule]
https://raw.githubusercontent.com/dayvight/loon-antigravity-rules/main/rules/antigravity-google-auth.list, policy=AI 手动, tag=Antigravity, enabled=true
```

### `rules/google-wildcard.list` —— 全域兜底版

7 条后缀接管整个 Google 生态。Google 以后新增任何域名都不会再漏，代价是 Gmail / Play / YouTube 全部流量也走代理。

```ini
[Remote Rule]
https://raw.githubusercontent.com/dayvight/loon-antigravity-rules/main/rules/google-wildcard.list, policy=AI 手动, tag=Google, enabled=true
```

### jsDelivr 镜像（国内拉取更稳）

```
https://cdn.jsdelivr.net/gh/dayvight/loon-antigravity-rules@main/rules/antigravity-google-auth.list
https://cdn.jsdelivr.net/gh/dayvight/loon-antigravity-rules@main/rules/google-wildcard.list
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

## License

MIT
