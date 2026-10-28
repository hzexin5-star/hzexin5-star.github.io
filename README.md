# AI 会员价格雷达 · 已上线

> ## 🌐 正式地址：<https://price.ireliashop.com/>
> 已配置**每天自动更新** + **强制 HTTPS**，你不需要做任何事。
> （备用地址 `https://hzexin5-star.github.io/` 会自动跳转到正式地址）

一个零成本、全自动的引流工具站：每天自动抓取上游公开商品数据，生成「AI 会员价格 / 库存 / 规格」汇总站。
每个商品都带**你的推广参数**（`?from=27695`），用户点进去下单，佣金自动归你。

---

## ✅ 域名绑定已完成

| 项目 | 结果 |
|---|---|
| 正式域名 | `price.ireliashop.com` |
| 解析商 | 阿里云（万网）云解析 |
| DNS 记录 | CNAME `price` → `hzexin5-star.github.io`（**已生效，国内可访问**） |
| HTTPS 证书 | ✅ 已签发（Let's Encrypt） |
| 强制 HTTPS | ✅ 已开启 |
| 与店铺关系 | 同主域 `ireliashop.com` — 品牌统一、SEO 权重互通；`www` 仍是你的店铺，未受影响 |

> 若以后要换子域名（如 `bi.ireliashop.com`）：改 `build.mjs` 的 `customDomain` + `siteUrl`，在阿里云加对应 CNAME，然后运行 `bind-domain.ps1 -Domain 新域名`。

---

## ✅ 现在的状态（已完成）

| 项目 | 状态 |
|---|---|
| 站点部署 | ✅ <https://hzexin5-star.github.io/> |
| 自动更新 | ✅ 每天北京时间 **06:00** 自动重新抓取价格并部署 |
| 商品页 | ✅ 26 个独立页面（含规格价格、库存、销量、商品说明） |
| 选购指南 | ✅ <https://hzexin5-star.github.io/guide.html> |
| 推广归因 | ✅ 所有商品 CTA 都带 `?from=27695`（30 天 Cookie） |
| SEO | ✅ title/description/canonical/JSON-LD/sitemap/robots 全套 |
| 搜索引擎提交 | ✅ 每次部署自动 ping IndexNow（Bing / Yandex） |
| 客服入口 | ✅ 页脚 QQ 群一键复制 |

**你不用管它，它每天自己更新。**

---

## 📦 仓库与自动化

- 代码仓库：`hzexin5-star/hzexin5-star.github.io`
- 部署方式：GitHub Actions（`.github/workflows/deploy.yml`）
  - 每天 UTC 22:00（北京 06:00）自动构建部署
  - 支持手动触发
  - 推送代码时自动构建

### ⚠️ 重要：你的网络访问不了 github.com 网页端

实测你这边 `github.com` 超时（被墙），但 **`api.github.com` 和 `github.io` 都能通**。
所以不能用浏览器管理仓库、也不能用 `git push`。**用下面的工具代替。**

---

## 🛠 三个双击就能用的工具

| 文件 | 作用 | 什么时候用 |
|---|---|---|
| `1-查看部署状态.bat` | 查看 Pages 状态、最近一次构建结果、线上是否正常 | 任何时候 |
| `2-立即刷新价格.bat` | 立即触发一次重新抓取 + 部署 | 想马上更新价格时（不用等第二天） |
| `3-上传代码改动.bat` | 把本地改过的代码通过 API 推送到 GitHub | 改了 `build.mjs` / `README.md` 之后 |
| `4-绑定域名.bat` | 绑定 `price.ireliashop.com`（自动配 GitHub Pages + HTTPS） | 阿里云加好 CNAME 记录之后 |

命令行等价写法：

```powershell
.\github.ps1 status     # 查看状态
.\github.ps1 rebuild    # 立即刷新价格
.\github.ps1 push       # 上传代码改动
.\github.ps1 open       # 在浏览器打开网站
```

> 原理：脚本从 Windows 凭据管理器读取你的 GitHub Token，走 `api.github.com` 提交，绕开被墙的 `github.com`。

---

## 📝 常见改动怎么做

### 1. 改品牌名 / 简介
编辑 `build.mjs` 顶部的 `CONFIG`：

```js
siteName: 'AI 会员价格雷达',
siteTagline: '...',
siteDesc: '...',
qqGroup: '1131806272',   // 页脚展示的 QQ 群
```

改完双击 `3-上传代码改动.bat`。

### 2. 改推广 ID
`CONFIG.from = '27695'`（现在就是你的，一般不用改）。

### 3. 排除某些商品/分类
```js
excludeCategoryIds: [140],   // 排除的分类
```
或改 `build.mjs` 里的 `.filter(...)` 链。

### 4. 本地预览
```bash
node build.mjs     # 生成到 dist/
```
然后用任意静态服务器打开 `dist/index.html`，或双击 `build.bat`。

### 5. 手动部署到其他平台（可选）
`dist/` 是纯静态目录，可以拖到 Netlify Drop / Cloudflare Pages / 任何静态托管。
> 注意：换域名后要同步改 `CONFIG.siteUrl`，否则 sitemap 和 canonical 会错。

---

## 📈 SEO 进度（自动化部分已做完，剩下是等）

- ✅ `sitemap.xml`（26+ URL）
- ✅ `robots.txt`
- ✅ 每个商品独立 URL + 独立 title/description
- ✅ JSON-LD 结构化数据（Product / Article / WebSite）
- ✅ Bing / Yandex 自动提交（IndexNow，每次部署自动 ping）

**还差一步（需要你花 3 分钟）：**
- Google 收录：<https://search.google.com/search-console> → 添加 `hzexin5-star.github.io` → 提交 sitemap
  （需要能访问 Google，你这边可能要开代理）

> 现实预期：SEO 是慢变量，前 1–2 个月基本没量。
> 这个站对你更直接的价值是**信任背书**——发内容、私聊时报出这个网址，用户对你的信任会明显不同。

---

## ⚠️ 关于域名（想升级的话）

现在用的是 GitHub 免费二级域名 `hzexin5-star.github.io`。

- 好处：免费、全自动、已经能访问
- 缺点：域名看起来不像"正经商家"，转化率会打折扣；且 `github.io` 在国内偶尔不稳

**建议后续花 ~¥30–60/年 买个域名**（如 `ai-price-radar.com`），绑定步骤：
1. 在域名商后台加 CNAME：`你的域名` → `hzexin5-star.github.io`
2. 在 `build.mjs` 改 `CONFIG.siteUrl`
3. 在仓库 Settings → Pages → Custom domain 填域名（这条需要能访问 github.com，可能要开代理，或者让我来操作）

---

## ⚖️ 合规说明

- 本站定位是「**公开价格信息整理工具**」，页脚已声明不参与交易、不提供售后，请保留这段声明。
- 商品名为上游原始数据，本站不做改写。
- 这是一个**引流工具**，不是收入本身。成交发生在你的私域和上游下单页。

---

## 📁 文件说明

```
irelia-toolsite/
├── build.mjs                    # 站点生成器（要改配置就改这里）
├── build.bat                    # 本地构建
├── package.json
├── README.md                    # 本文件
├── github.ps1                   # GitHub 自动化工具（国内可用）
├── bind-domain.ps1             # 绑定自定义域名
├── 1-查看部署状态.bat
├── 2-立即刷新价格.bat
├── 3-上传代码改动.bat
├── 4-绑定域名.bat
├── .github/workflows/deploy.yml # 每日自动构建 + 部署 + IndexNow
└── dist/                        # 本地构建产物（不提交，由 Actions 生成）
```
