# AI 会员价格雷达 · 静态站生成器

一个**零成本、零维护**的引流工具站：抓取上游公开商品数据，生成一个「AI 会员价格 / 库存 / 规格」汇总站。
每个商品都带**你的推广参数**（`?from=你的商户ID`），用户点进去下单，佣金自动归你。

- 纯静态 HTML，30 个页面约 240KB，加载极快
- 自带 SEO：独立商品页、title/description、JSON-LD 结构化数据、sitemap、robots
- 自带站内搜索、分类筛选、价格排序
- 自带一篇《AI 会员选购指南》长文（用于获取长尾搜索流量）

---

## 一、先改 3 个配置（1 分钟）

打开 `build.mjs`，找到最上面的 `CONFIG`：

```js
const CONFIG = {
  base: 'https://www.ireliashop.com',   // 不用改
  from: '27695',                        // ★ 改成你的商户ID（现在已经是你的了）
  siteName: 'AI 会员价格雷达',            // ★ 改成你的品牌名
  siteTagline: '...',                   // 站点副标题
  siteDesc: '...',                      // 站点简介（会进 SEO 描述）
  siteUrl: 'https://ai-price-radar.pages.dev', // ★ 部署后改成你的真实域名
  ...
};
```

> `from` 就是后台「我的主页 → 推广链接」里的 `?from=27695` 那个数字。
> 用户通过你的站跳到下单页后，上游会给浏览器写入 30 天的 `promotion_from` Cookie，**成交佣金算你的**（已验证）。

---

## 二、构建（10 秒）

双击 `build.bat`，或者在命令行里：

```bash
node build.mjs
```

看到 `[5/5] 完成 ✅` 后，所有文件都在 **`dist/`** 文件夹里。

构建过程会：
1. 拉取商品分类（9 个）
2. 拉取商品列表（28 个）
3. 逐个抓取商品详情页 → 提取规格价格、库存、销量、商品说明
4. 生成 `index.html` + 28 个商品页 + `guide.html` + `sitemap.xml` + `robots.txt`

---

## 三、部署（免费，5 分钟）

### 方案 A：Netlify Drop（最简单，拖拽即上线）

1. 打开 <https://app.netlify.com/drop>
2. 把 **`dist` 文件夹**整个拖进去
3. 立刻得到一个 `https://随机名字.netlify.app` 域名
4. 注册账号可保留站点、改名、绑定自己的域名

### 方案 B：Cloudflare Pages（国内访问相对稳定）

1. 注册 <https://dash.cloudflare.com/>
2. 左侧 **Workers & Pages** → **Create** → **Pages** → **Upload assets**
3. 项目名随便填 → 把 `dist` 文件夹拖进去 → **Deploy**
4. 得到 `https://你的项目名.pages.dev`

### 方案 C：国内可访问（需要域名备案）

- 腾讯云 **EdgeOne Pages**（有免费额度，国内节点）
- 阿里云 **OSS 静态网站托管** + CDN
- 注意：国内节点 + 自定义域名需要 **ICP 备案**

---

## 四、每日更新价格（30 秒）

商品价格和库存会变，建议每天重新构建一次：

```
双击 build.bat → 进托管后台 → 重新上传 dist
```

想全自动的话（可选，需要一点点动手能力）：
- 把项目推到 GitHub
- 用 GitHub Actions 定时跑 `node build.mjs`
- 用 Cloudflare Pages 连 GitHub，自动部署

> 提示：页面顶部会显示「数据更新于 XXXX」，用户能看出数据新鲜度，不必追求实时。

---

## 五、让搜索引擎收录（重要）

部署完拿到域名后：

1. **Google Search Console**：<https://search.google.com/search-console>
   - 添加资源 → 输入你的域名 → 验证（DNS 或 HTML 文件）
   - 提交 sitemap：`https://你的域名/sitemap.xml`
2. **Bing Webmaster**：<https://www.bing.com/webmasters>
   - 同样提交 sitemap（Bing 在国内可访问，值得做）
3. 百度需要备案网站，海外域名收录效果差，**不要指望百度**

> 现实预期：SEO 是慢变量，前 1–2 个月基本没量。这个站对你更直接的价值是——
> **作为一个「专业工具站」的信任背书**：发内容、发群、私聊时说「我做了个比价工具，你先自己查」，比直接报价值钱得多。

---

## 六、绑定自己的域名（可选，推荐）

托管平台都支持绑定自定义域名（免费）。有了自己的域名后：

1. 把 `CONFIG.siteUrl` 改成新域名
2. 重新构建 + 重新部署
3. 到 Google/Bing 重新提交 sitemap

---

## 七、常见问题

**Q：价格不对 / 有商品没抓到？**
上游商品上下架、改价是实时的。重新跑一次 `node build.mjs` 即可。

**Q：会不会被上游认为是抄袭？**
你是上游的分销商，帮他带流量和成交，这是分销的正常玩法。而且你的站有自己的价格对比、规格整理、选购指南，不是简单复制。

**Q：需要服务器吗？**
不需要。纯静态文件，任何静态托管都能放。

**Q：会不会被平台封？**
这是你自己的独立域名站点，不依赖闲鱼/小红书，不受它们封号影响。唯一要注意的是内容合规（见下文）。

---

## 八、注意事项

- 本站定位是「**公开价格信息整理工具**」，页脚已声明不参与交易、不提供售后，请保留这段声明。
- 商品名里如果出现敏感词（如具体平台名），建议你自己在 `CONFIG` 里加一层替换规则，或接受现状——独立站没有平台审核，风险主要来自支付通道和上游。
- 这是一个**引流工具**，不是收入本身。真正的成交还是发生在你的私域和上游下单页。

---

## 文件说明

```
irelia-toolsite/
├── build.mjs        # 生成器（主要改这个）
├── build.bat        # 双击构建
├── package.json
├── README.md        # 本文件
├── dist/            # ← 构建产物，上传这个文件夹
│   ├── index.html       # 首页（搜索/筛选/排序）
│   ├── guide.html       # 选购指南长文（SEO）
│   ├── p/1.html ...     # 每个商品一个独立页
│   ├── assets/          # 样式 + 交互 JS
│   ├── sitemap.xml
│   └── robots.txt
└── preview-*.png    # 效果截图
```
