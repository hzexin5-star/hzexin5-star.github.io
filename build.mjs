#!/usr/bin/env node
/**
 * AI 会员价格雷达 —— 静态站生成器
 *
 * 数据来源：ireliashop.com 公开商品接口 + 商品详情页（服务端抓取，无跨域问题）
 * 产出：dist/ 纯静态站点，可直接拖到 Cloudflare Pages / GitHub Pages / 任意静态托管
 *
 * 用法：
 *   1) 修改下面 CONFIG 里的 from（你的商户ID）、siteName、siteUrl
 *   2) node build.mjs
 *   3) 把 dist 文件夹上传部署
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ============================== 配置区 ==============================
const CONFIG = {
  // 你的上游商品站（一般不用改）
  base: 'https://www.ireliashop.com',

  // ★ 你的商户ID / 推广ID（必须改！这是佣金归因的关键）
  from: '27695',

  // 站点信息（改成你自己的品牌）
  siteName: 'AI 会员价格雷达',
  siteTagline: 'AI 会员 / 账号 / 订阅 全网价格与库存汇总',
  siteDesc:
    'AI 会员价格雷达：汇总 ChatGPT、Claude、Gemini、Grok、Perplexity 等 AI 会员与账号的实时价格、库存与规格，帮你快速对比、少花冤枉钱。',
  // 你的 QQ 群（显示在页脚，方便用户咨询）
  qqGroup: '1131806272',
  // ★ 部署后你的真实域名（sitemap / canonical 会用到）
  // 已部署到 GitHub Pages：https://hzexin5-star.github.io
  siteUrl: 'https://hzexin5-star.github.io',

  // IndexNow 密钥（用于自动向 Bing / Yandex 提交新页面，无需账号）
  indexNowKey: 'f3a91c7e5b2d48a6c1e9f0b7d3a5c8e2',

  outDir: 'dist',
  // 排除分类（140 = 上游的"测试"分类）
  excludeCategoryIds: [140],
  // 抓取并发
  concurrency: 5,
  // 每个商品说明最多保留多少字
  descLimit: 420,
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ============================== 工具函数 ==============================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, retry = 2) {
  for (let i = 0; i <= retry; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Accept: 'text/html,application/json,*/*',
        },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (err) {
      if (i === retry) throw err;
      await sleep(500 * (i + 1));
    }
  }
}

async function fetchJSON(url) {
  return JSON.parse(await fetchText(url));
}

/** 并发池 */
async function pool(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = null;
      }
      done++;
      if (onProgress && (done % 5 === 0 || done === items.length)) onProgress(done, items.length);
    }
  });
  await Promise.all(runners);
  return results;
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const money = (n) => Number(n).toFixed(2);

function fmtSold(n) {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return String(n);
}

/** 中文摘要截断 */
function clip(text, limit) {
  text = (text || '').trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit).replace(/[，。、；：,.\s]+$/, '') + '…';
}

// ============================== 数据抓取 ==============================
async function loadCategories() {
  const res = await fetchJSON(`${CONFIG.base}/user/api/index/data`);
  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows
    .filter((c) => c && c.status === 1)
    .filter((c) => !CONFIG.excludeCategoryIds.includes(Number(c.id)))
    .filter((c) => !/测试/.test(c.name || ''))
    .map((c) => ({
      id: Number(c.id),
      name: c.name,
      icon: c.icon || '',
      count: Number(c.commodity_count) || 0,
      sort: Number(c.sort) || 0,
    }))
    .sort((a, b) => a.sort - b.sort);
}

async function loadCommodities() {
  const all = [];
  for (let page = 1; page <= 30; page++) {
    const url = `${CONFIG.base}/user/api/index/commodity?categoryId=0&limit=100&page=${page}&keywords=`;
    const res = await fetchJSON(url);
    // 接口返回结构可能是 { data: [...] }，也可能被包装成 { data: { list: [...] } }
    const data = res?.data;
    const batch = Array.isArray(data)
      ? data
      : Array.isArray(data?.list)
      ? data.list
      : [];
    all.push(...batch);
    const total = Number(data?.total) || 0;
    if (batch.length === 0 || batch.length < 100 || (total && all.length >= total)) break;
    await sleep(150);
  }
  // 去重
  const map = new Map();
  for (const p of all) map.set(Number(p.id), p);
  return [...map.values()];
}

/** 解析商品详情页：规格价格、库存、详情文本 */
function parseItemPage(html) {
  const out = { variants: [], desc: '', stockRaw: null, sold: null };

  const m = html.match(/setVar\("_var_item",(\{[\s\S]*?\})\);<\/script>/);
  if (m) {
    try {
      const item = JSON.parse(m[1]);
      if (item?.config?.category && typeof item.config.category === 'object') {
        out.variants = Object.entries(item.config.category)
          .map(([name, price]) => ({ name: String(name).trim(), price: Number(price) }))
          .filter((v) => Number.isFinite(v.price) && v.price > 0)
          // 过滤上游用来占位的「说明性条目」：9999 等虚高价、超长描述、售后说明
          .filter((v) => v.price < 9000)
          .filter((v) => v.name.length <= 30)
          .filter((v) => !/换号|介意|以上均为|说明|备注|拍这个|请联系|咨询客服/.test(v.name));
      }
      if (item?.order_sold != null) out.sold = Number(item.order_sold);
      if (item?.stock != null && /^\d+$/.test(String(item.stock))) out.stockRaw = Number(item.stock);
    } catch {
      /* ignore */
    }
  }

  const di = html.indexOf('tokyo-description-body');
  if (di >= 0) {
    // 从该 class 所在标签的 '>' 之后开始，避免把 class="..."> 残留进正文
    const tagEnd = html.indexOf('>', di);
    let chunk = html.slice(tagEnd >= 0 ? tagEnd + 1 : di, di + 24000);
    for (const stop of ['联系方式', '相关商品', '猜你喜欢', '商品咨询', '购买咨询']) {
      const si = chunk.indexOf(stop);
      if (si > 0) chunk = chunk.slice(0, si);
    }
    out.desc = clip(
      chunk
        .replace(/<img[^>]*>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#\d+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      CONFIG.descLimit
    );
  }
  return out;
}

/** 根据商品特征生成「选购要点」（增加页面原创度 + 提升转化） */
function buildPickPoints(p) {
  const name = p.name || '';
  const tags = (p.tags_list || []).join(',');
  const text = name + ' ' + tags;
  const pts = [];

  if (/官方直充|官方充值|直充/.test(text)) {
    pts.push('直充到你自己的账号：需要按客服要求提供账号信息，开通后订阅归属你本人，续费与找回更省心。');
  } else if (/成品号|成品账号/.test(text)) {
    pts.push('成品账号：直接交付账号与密码，不需要你的原账号信息，但务必先看清质保范围（首登 / 1 个月 / 全程）。');
  }
  if (/CDK|cdk|激活码|兑换码|激活链接/.test(text)) {
    pts.push('卡密/激活链接形式：自助兑换，适合已经有账号、只想补会员的用户，注意兑换渠道与有效期。');
  }
  if (/家庭组|席位|拼车|家庭组席位/.test(text)) {
    pts.push('家庭组席位：属于共享订阅，价格低但受地区与成员人数限制，加入前后都要确认区服一致。');
  }
  if (/接码|实卡|验证码/.test(text)) {
    pts.push('接码类服务：用于接收验证码，重点看有效天数与成功率，长期使用建议选长有效期。');
  }
  if (/质保/.test(text)) {
    pts.push('带质保的商品价格更高但售后更稳，掉号/封号的补发规则请在下单页确认清楚。');
  }
  if (/邮箱|Gmail|谷歌邮箱/.test(text)) {
    pts.push('邮箱类商品适合需要注册 AI 工具、学习或长期使用的用户，建议到手后立即修改密码并绑定 2FA。');
  }
  if (pts.length === 0) {
    pts.push('下单前先确认套餐类型（成品号 / 直充 / 卡密），不同类型交付方式和售后规则完全不同。');
  }
  if (pts.length < 3) {
    pts.push('价格会随上游库存波动，下单前请以商品页显示的实时价格与库存为准。');
  }
  if (pts.length < 3) {
    pts.push('建议先小额试单验证交付速度和售后响应，再决定是否长期购买或批量采购。');
  }
  return pts.slice(0, 3);
}

// ============================== 模板 ==============================
const CSS = String.raw`
:root{
  --bg:#f7f8fb; --panel:#fff; --fg:#111827; --muted:#6b7280; --line:#e6e8ef;
  --brand:#4f46e5; --brand-soft:#eef2ff; --ok:#10b981; --warn:#f59e0b; --danger:#ef4444;
  --radius:14px; --shadow:0 4px 18px rgba(17,24,39,.06);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
.wrap{max-width:1140px;margin:0 auto;padding:0 18px}
header.site{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.site-inner{max-width:1140px;margin:0 auto;padding:0 18px;height:62px;display:flex;align-items:center;justify-content:space-between;gap:14px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;letter-spacing:.2px}
.brand-mark{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#4f46e5,#0ea5e9);color:#fff;display:grid;place-items:center;font-size:16px;font-weight:900}
nav.site-nav{display:flex;gap:4px;overflow:auto}
nav.site-nav a{padding:7px 12px;border-radius:999px;color:var(--muted);font-size:14px;white-space:nowrap}
nav.site-nav a:hover{background:var(--brand-soft);color:var(--brand)}
.hero{padding:34px 0 10px}
.hero h1{margin:0 0 8px;font-size:30px;line-height:1.25;letter-spacing:-.2px}
.hero p{margin:0;color:var(--muted);font-size:15px}
.searchbar{margin:20px 0 6px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.searchbar input{flex:1 1 280px;min-width:0;padding:12px 16px;border:1px solid var(--line);border-radius:12px;font-size:15px;background:#fff;outline:none}
.searchbar input:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.updated{font-size:12.5px;color:var(--muted)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 6px}
.chip{border:1px solid var(--line);background:#fff;color:#374151;padding:7px 13px;border-radius:999px;font-size:13.5px;cursor:pointer;white-space:nowrap}
.chip.on{background:var(--brand);border-color:var(--brand);color:#fff}
.chip small{opacity:.65;margin-left:4px}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:18px 0 12px}
.toolbar .count{font-size:13.5px;color:var(--muted)}
.sorts{display:flex;gap:6px}
.sorts button{border:1px solid var(--line);background:#fff;border-radius:10px;padding:7px 11px;font-size:13px;cursor:pointer;color:#374151}
.sorts button.on{background:var(--brand-soft);border-color:#c7d2fe;color:var(--brand);font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:14px;padding-bottom:40px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;transition:.16s}
.card:hover{transform:translateY(-2px);box-shadow:var(--shadow);border-color:#d8dce8}
.card-cover{aspect-ratio:16/9;background:#f1f3f9;overflow:hidden}
.card-cover img{width:100%;height:100%;object-fit:cover}
.card-body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:8px;flex:1}
.card-cat{font-size:11.5px;color:var(--brand);background:var(--brand-soft);border-radius:6px;padding:2px 7px;align-self:flex-start}
.card-name{font-size:14px;font-weight:700;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:40px}
.card-meta{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:auto}
.price{color:var(--danger);font-weight:800;font-size:17px}
.price small{font-size:11.5px;font-weight:600;color:var(--muted);margin-left:3px}
.sold{font-size:12px;color:var(--muted)}
.badges{display:flex;gap:6px;flex-wrap:wrap}
.badge{font-size:11.5px;padding:2px 7px;border-radius:6px;background:#f3f4f6;color:#4b5563}
.badge.ok{background:#ecfdf5;color:#047857}
.badge.warn{background:#fffbeb;color:#b45309}
.badge.off{background:#fef2f2;color:#b91c1c}
.empty{padding:60px 0;text-align:center;color:var(--muted)}
.crumbs{font-size:13px;color:var(--muted);padding:18px 0 6px}
.crumbs a{color:var(--brand)}
.detail{display:grid;grid-template-columns:1.15fr .85fr;gap:22px;padding-bottom:30px}
@media(max-width:860px){.detail{grid-template-columns:1fr}.hero h1{font-size:23px}}
.panel{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.panel h2{margin:0 0 12px;font-size:16px}
.detail h1{font-size:21px;line-height:1.4;margin:2px 0 14px}
.price-big{color:var(--danger);font-weight:900;font-size:30px;line-height:1.1}
.price-big small{font-size:13px;color:var(--muted);font-weight:600;margin-left:6px}
.cta{display:block;text-align:center;background:linear-gradient(135deg,#4f46e5,#0ea5e9);color:#fff;font-weight:800;padding:14px;border-radius:12px;margin:16px 0 10px;font-size:16px}
.cta:hover{filter:brightness(1.05)}
.cta-sub{text-align:center;font-size:12.5px;color:var(--muted)}
table.variants{width:100%;border-collapse:collapse;font-size:14px}
table.variants td{padding:9px 6px;border-bottom:1px dashed var(--line)}
table.variants td:last-child{text-align:right;font-weight:800;color:var(--danger);white-space:nowrap}
ul.points{margin:0;padding-left:19px}
ul.points li{margin:7px 0;font-size:14px;color:#374151}
.desc{font-size:14px;color:#374151;white-space:pre-wrap;word-break:break-word}
.related{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
.related a{display:block;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:13px}
.related a:hover{border-color:var(--brand);color:var(--brand)}
.prose{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:26px;margin:18px 0 40px}
.prose h2{font-size:19px;margin:26px 0 10px}
.prose h2:first-child{margin-top:0}
.prose h3{font-size:15.5px;margin:18px 0 8px}
.prose p,.prose li{font-size:14.5px;color:#384152}
.prose table{width:100%;border-collapse:collapse;font-size:14px;margin:12px 0}
.prose th,.prose td{border:1px solid var(--line);padding:9px 11px;text-align:left}
.prose th{background:#f8fafc;font-weight:700}
.tip{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:13.5px;color:#92400e;margin:14px 0}
footer.site{border-top:1px solid var(--line);background:#fff;margin-top:20px}
.foot{max-width:1140px;margin:0 auto;padding:26px 18px 40px;font-size:12.5px;color:var(--muted);line-height:1.8}
.foot strong{color:#374151}
.float-cta{position:fixed;right:18px;bottom:18px;z-index:60;display:flex;align-items:center;gap:8px;
  background:linear-gradient(135deg,#4f46e5,#0ea5e9);color:#fff;font-weight:800;font-size:14px;
  padding:12px 18px;border-radius:999px;box-shadow:0 10px 26px rgba(79,70,229,.35);transition:.18s}
.float-cta:hover{transform:translateY(-2px);filter:brightness(1.06)}
@media(max-width:640px){.float-cta{right:12px;bottom:12px;padding:11px 15px;font-size:13px}}
.contact-line{color:#4b5563}
.copy-qq{color:var(--brand);font-weight:700;border-bottom:1px dashed #c7d2fe;padding-bottom:1px}
.copy-qq:hover{color:#3730a3}
`;

function layout({ title, desc, canonical, body, jsonld, siteUrl }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<link rel="stylesheet" href="/assets/style.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body>
<header class="site">
  <div class="site-inner">
    <a class="brand" href="/"><span class="brand-mark">◎</span><span>${esc(CONFIG.siteName)}</span></a>
    <nav class="site-nav">
      <a href="/">最新价格</a>
      <a href="/guide.html">选购指南</a>
    </nav>
  </div>
</header>
${body}
<footer class="site">
  <div class="foot">
    <p><strong>${esc(CONFIG.siteName)}</strong> · ${esc(CONFIG.siteTagline)}</p>
    <p class="contact-line">价格疑问 / 选型建议：<a href="javascript:;" class="copy-qq" data-copy="${esc(CONFIG.qqGroup)}">QQ 群 ${esc(CONFIG.qqGroup)}</a>（点击复制，群里回复更快）</p>
    <p>本站仅做公开价格与库存信息的整理与展示，<b>不销售任何商品、不参与交易、不提供售后</b>。所有商品与价格以下单页面为准，购买前请自行核对商品说明与质保条款。</p>
    <p>AI 会员与账号类商品存在官方风控、掉号、封号等风险，请评估自身风险后再购买。部分商品可能受服务条款限制，请遵守相关平台规则。</p>
  </div>
</footer>
<a class="float-cta" href="${esc(CONFIG.base)}?from=${esc(CONFIG.from)}" target="_blank" rel="nofollow noopener">🛒 查看全部商品 / 实时价格</a>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

function cardHtml(p) {
  const priceHtml =
    p.max > p.min
      ? `¥${money(p.min)}<small>起</small>`
      : `¥${money(p.min)}`;
  const badges = [];
  if (p.stockState === 0) badges.push('<span class="badge off">售罄</span>');
  else if (/预订/.test(p.stock || '')) badges.push('<span class="badge warn">可预订</span>');
  else badges.push('<span class="badge ok">有货</span>');
  if (p.sold > 0) badges.push(`<span class="badge">已售 ${fmtSold(p.sold)}</span>`);

  return `<a class="card item" href="/p/${p.id}.html" data-name="${esc((p.name || '').toLowerCase())}" data-cat="${p.catId}" data-price="${p.min}" data-sold="${p.sold}" data-stock="${p.stockState}">
  <div class="card-cover">${p.cover ? `<img src="${esc(p.cover)}" alt="${esc(clip(p.name, 40))}" loading="lazy" referrerpolicy="no-referrer">` : ''}</div>
  <div class="card-body">
    <span class="card-cat">${esc(p.catName)}</span>
    <div class="card-name">${esc(p.name)}</div>
    <div class="badges">${badges.join('')}</div>
    <div class="card-meta"><span class="price">${priceHtml}</span></div>
  </div>
</a>`;
}

// ============================== 页面渲染 ==============================
function renderIndex(products, categories, builtAt) {
  const chips = [`<button class="chip on" data-cat="0">全部<small>${products.length}</small></button>`]
    .concat(
      categories
        .filter((c) => products.some((p) => p.catId === c.id || (p.displayCats || []).includes(c.id)))
        .map(
          (c) =>
            `<button class="chip" data-cat="${c.id}">${esc(c.name)}</button>`
        )
    )
    .join('\n');

  const body = `
<main class="wrap">
  <section class="hero">
    <h1>AI 会员 / 账号 / 订阅 全网价格汇总</h1>
    <p>${esc(CONFIG.siteDesc)}</p>
    <div class="searchbar">
      <input id="q" type="search" placeholder="搜索：ChatGPT / Claude / Gemini / Grok / Figma …" autocomplete="off">
    </div>
    <div class="updated">数据更新于 ${esc(builtAt)} · 共 ${products.length} 个在售商品 · 价格与库存以下单页为准</div>
    <div class="chips" id="chips">${chips}</div>
  </section>
  <div class="toolbar">
    <span class="count" id="count">共 ${products.length} 个商品</span>
    <div class="sorts" id="sorts">
      <button class="on" data-sort="sold">销量优先</button>
      <button data-sort="priceAsc">价格从低到高</button>
      <button data-sort="priceDesc">价格从高到低</button>
    </div>
  </div>
  <section class="grid" id="grid">
    ${products.map(cardHtml).join('\n')}
  </section>
  <div class="empty" id="empty" style="display:none">没有匹配的商品，换个关键词试试</div>
</main>`;

  return layout({
    title: `${CONFIG.siteName} - AI 会员价格对比｜ChatGPT/Claude/Gemini/Grok 实时价格`,
    desc: CONFIG.siteDesc,
    canonical: `${CONFIG.siteUrl}/`,
    body,
    siteUrl: CONFIG.siteUrl,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: CONFIG.siteName,
      url: CONFIG.siteUrl,
      description: CONFIG.siteDesc,
    },
  });
}

function renderItem(p, related, builtAt, categories) {
  const catName = p.catName || 'AI 会员';
  const priceRange =
    p.max > p.min ? `¥${money(p.min)} - ¥${money(p.max)}` : `¥${money(p.min)}`;
  const buyUrl = `${CONFIG.base}/item/${p.id}?from=${CONFIG.from}`;
  const points = buildPickPoints({
    name: p.name,
    tags_list: p.tagsList || [],
  });

  const variants =
    p.variants && p.variants.length
      ? `<div class="panel" style="margin-top:14px"><h2>可选规格与价格</h2>
        <table class="variants">${p.variants
          .slice(0, 12)
          .map(
            (v) =>
              `<tr><td>${esc(v.name)}</td><td>¥${money(v.price)}</td></tr>`
          )
          .join('')}</table>
        <p style="font-size:12.5px;color:var(--muted);margin:10px 0 0">实际价格以商品下单页为准</p></div>`
      : '';

  const descBlock = p.desc
    ? `<div class="panel" style="margin-top:14px"><h2>商品说明（来自商家页面）</h2><div class="desc">${esc(p.desc)}</div></div>`
    : '';

  const body = `
<main class="wrap">
  <div class="crumbs"><a href="/">首页</a> / <a href="/">${esc(catName)}</a> / <span>${esc(clip(p.name, 26))}</span></div>
  <div class="detail">
    <div>
      <div class="panel">
        <span class="card-cat">${esc(catName)}</span>
        <h1>${esc(p.name)}</h1>
        <div class="price-big">${priceRange}${p.max > p.min ? '<small>不同规格价格不同</small>' : ''}</div>
        <div class="badges" style="margin:12px 0">
          ${
            p.stockState === 0
              ? '<span class="badge off">暂时售罄</span>'
              : /预订/.test(p.stock || '')
              ? '<span class="badge warn">可预订</span>'
              : '<span class="badge ok">有货</span>'
          }
          ${p.sold > 0 ? `<span class="badge">累计已售 ${fmtSold(p.sold)}</span>` : ''}
          ${p.deliveryWay === 0 ? '<span class="badge">自动发货</span>' : '<span class="badge">人工发货</span>'}
        </div>
        <a class="cta" href="${esc(buyUrl)}" target="_blank" rel="nofollow noopener">查看实时价格 / 立即购买 →</a>
        <div class="cta-sub">跳转到商家下单页，价格与库存以该页为准 · 更新于 ${esc(builtAt)}</div>
      </div>
      ${variants}
      ${descBlock}
    </div>
    <aside>
      <div class="panel">
        <h2>选购要点</h2>
        <ul class="points">${points.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>
      <div class="panel" style="margin-top:14px">
        <h2>同类商品推荐</h2>
        <div class="related">
          ${related
            .map(
              (r) =>
                `<a href="/p/${r.id}.html">${esc(clip(r.name, 34))} <span style="color:#ef4444;font-weight:700">¥${money(r.min)}</span></a>`
            )
            .join('')}
        </div>
      </div>
      <div class="tip" style="margin-top:14px">
        提示：账号/会员类商品受官方风控影响，存在掉订阅、封号的可能。下单前务必确认质保范围与补发规则。
      </div>
    </aside>
  </div>
</main>`;

  return layout({
    title: `${p.name} 价格 ${priceRange} - ${CONFIG.siteName}`,
    desc: clip(
      `${p.name}：当前价格 ${priceRange}${p.sold ? `，累计已售 ${fmtSold(p.sold)}` : ''}。${p.desc || CONFIG.siteDesc}`,
      155
    ),
    canonical: `${CONFIG.siteUrl}/p/${p.id}.html`,
    body,
    siteUrl: CONFIG.siteUrl,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      image: p.cover || undefined,
      description: clip(p.desc || CONFIG.siteDesc, 300),
      category: catName,
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'CNY',
        lowPrice: money(p.min),
        highPrice: money(p.max),
        offerCount: p.variants?.length || 1,
        availability:
          p.stockState === 0
            ? 'https://schema.org/OutOfStock'
            : 'https://schema.org/InStock',
      },
    },
  });
}

function renderGuide(products, builtAt) {
  const cheapest = [...products].sort((a, b) => a.min - b.min)[0];
  const body = `
<main class="wrap">
  <div class="crumbs"><a href="/">首页</a> / <span>选购指南</span></div>
  <article class="prose">
    <h1 style="font-size:26px;margin:0 0 6px">AI 会员怎么买不踩坑：类型、质保与选购指南</h1>
    <p style="color:#6b7280;font-size:13px;margin:0 0 18px">更新于 ${esc(builtAt)} · 阅读约 6 分钟</p>

    <p>同一个 AI 会员，不同渠道的价格可能差好几倍，原因通常不在「贵不贵」，而在<b>商品类型不同</b>。买之前先搞清这一件事，能避开大多数坑。</p>

    <h2>一、先分清四种常见商品类型</h2>
    <table>
      <thead><tr><th>类型</th><th>交付方式</th><th>适合谁</th><th>风险点</th></tr></thead>
      <tbody>
        <tr><td>官方直充 / 代充</td><td>商家帮你在自己的账号上开通会员</td><td>已有账号、想长期稳定使用</td><td>需要提供账号信息，务必找可信渠道</td></tr>
        <tr><td>成品账号</td><td>直接给你一个已开好会员的账号</td><td>没有账号、想立刻用</td><td>质保范围差异极大，常见「仅质保首登」</td></tr>
        <tr><td>卡密 / 激活链接 / CDK</td><td>给你一串码或链接，自己去兑换</td><td>有账号、想自己操作</td><td>兑换渠道受限、有有效期</td></tr>
        <tr><td>家庭组 / 拼车席位</td><td>把你拉进一个共享订阅</td><td>预算有限、能接受共享</td><td>受地区与人数限制，可能被移出</td></tr>
      </tbody>
    </table>

    <div class="tip">低价往往对应「更短的质保」或「共享/日抛」商品。看到远低于市场价的报价，先问一句：<b>质保多久？掉号补不补？</b></div>

    <h2>二、「质保」两个字，必须问清楚三件事</h2>
    <ul>
      <li><b>质保多久？</b>常见有「仅质保首登」「质保 7 天」「质保 1 个月」「全程质保」。</li>
      <li><b>什么情况补、什么情况不补？</b>比如人机验证、修改密码、IP 风险导致的风控，通常不在质保范围。</li>
      <li><b>怎么补？</b>是补新号、退款、还是换规格，流程要走多久。</li>
    </ul>
    <p>「仅质保首登」意味着你第一次成功登录后，商家就不再负责。这类商品价格最低，适合有经验、能自己处理风控的用户。</p>

    <h2>三、价格差异为什么这么大？</h2>
    <p>影响价格的主要因素有四个：</p>
    <ul>
      <li><b>账号来源与权重</b>：原生注册、老号、高权重号更贵；批量新号更便宜但更容易掉。</li>
      <li><b>会员时长承诺</b>：承诺 1 个月和「只承诺有会员标识、不承诺时长」是两个价。</li>
      <li><b>订阅来源</b>：官方直充 &gt; 地区低价区 &gt; 第三方渠道 &gt; 共享席位。</li>
      <li><b>质保力度</b>：质保越长，商家要预留的补发成本越高，价格也越高。</li>
    </ul>
    <p>本站汇总的价格从 ¥${cheapest ? money(cheapest.min) : '0.00'} 起，跨度很大，正是因为这些因素叠加。<b>不要只比价格，要比「同样的东西」。</b></p>

    <h2>四、下单前的核对清单</h2>
    <ul>
      <li>商品名里的套餐名是否和你以为的一致（Plus / Pro / Max / Team 差别很大）。</li>
      <li>是否需要提供你自己的账号？账号归属是谁？</li>
      <li>交付方式：自动发货还是人工？大概多久？</li>
      <li>售后入口在哪里？响应时间多久？</li>
      <li>是否支持分次小额试单。</li>
    </ul>

    <h2>五、账号到手后立刻做的三件事</h2>
    <ul>
      <li>改密码，并绑定自己的辅助邮箱（如果商品允许）。</li>
      <li>开启两步验证（2FA），保存好恢复码。</li>
      <li>固定使用同一个干净网络环境，避免同一账号在多地区频繁切换。</li>
    </ul>

    <h2>六、常见问题</h2>
    <h3>为什么有些商品显示「可预订」？</h3>
    <p>库存紧张时商家会开放预订，付款后按顺序补货自动发货，急用的话建议选现货商品。</p>
    <h3>价格多久更新一次？</h3>
    <p>本站数据来自公开商品页，页面显示「更新于」的时间。实际下单价格以商家下单页为准。</p>
    <h3>本站卖东西吗？</h3>
    <p>不卖。本站只做公开价格与库存信息的整理展示，交易与售后都在商家页面完成。</p>

    <p style="margin-top:26px"><a class="cta" href="/" style="display:inline-block;padding:12px 26px">返回查看最新价格 →</a></p>
  </article>
</main>`;

  return layout({
    title: `AI 会员选购指南：直充 / 成品号 / 卡密 / 拼车怎么选 - ${CONFIG.siteName}`,
    desc: 'AI 会员四种商品类型有什么区别？质保怎么判断？价格差在哪？一份给新手的 AI 会员选购与避坑指南。',
    canonical: `${CONFIG.siteUrl}/guide.html`,
    body,
    siteUrl: CONFIG.siteUrl,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'AI 会员选购指南：直充 / 成品号 / 卡密 / 拼车怎么选',
      dateModified: new Date().toISOString(),
      author: { '@type': 'Organization', name: CONFIG.siteName },
    },
  });
}

const APP_JS = String.raw`
(function(){
  var q=document.getElementById('q');
  var grid=document.getElementById('grid');
  var chips=document.getElementById('chips');
  var sorts=document.getElementById('sorts');
  var count=document.getElementById('count');
  var empty=document.getElementById('empty');

  // 一键复制 QQ 群号（所有页面可用）
  document.addEventListener('click', function(e){
    var el = e.target && e.target.closest ? e.target.closest('[data-copy]') : null;
    if(!el) return;
    e.preventDefault();
    var txt = el.getAttribute('data-copy');
    var done = function(){
      var old = el.textContent;
      el.textContent = '已复制：' + txt;
      setTimeout(function(){ el.textContent = old; }, 1800);
    };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(done, done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); }catch(ignore){}
      document.body.removeChild(ta); done();
    }
  });

  if(!grid)return;
  var cards=Array.prototype.slice.call(grid.querySelectorAll('.item'));
  var state={kw:'',cat:0,sort:'sold'};

  function apply(){
    var kw=state.kw.trim().toLowerCase();
    var shown=0;
    cards.forEach(function(c){
      var okKw=!kw||c.getAttribute('data-name').indexOf(kw)>-1;
      var okCat=!state.cat||c.getAttribute('data-cat')===String(state.cat);
      var okStock=state.sort!=='stock'||c.getAttribute('data-stock')!=='0';
      var ok=okKw&&okCat&&okStock;
      c.style.display=ok?'':'none';
      if(ok)shown++;
    });
    var sorted=cards.slice().sort(function(a,b){
      if(state.sort==='sold')return Number(b.getAttribute('data-sold'))-Number(a.getAttribute('data-sold'));
      if(state.sort==='priceAsc')return Number(a.getAttribute('data-price'))-Number(b.getAttribute('data-price'));
      if(state.sort==='priceDesc')return Number(b.getAttribute('data-price'))-Number(a.getAttribute('data-price'));
      return 0;
    });
    sorted.forEach(function(c){grid.appendChild(c)});
    if(count)count.textContent='共 '+shown+' 个商品';
    if(empty)empty.style.display=shown?'none':'block';
  }

  if(q){q.addEventListener('input',function(){state.kw=q.value;apply()})}
  if(chips){chips.addEventListener('click',function(e){
    var b=e.target.closest('.chip'); if(!b)return;
    Array.prototype.forEach.call(chips.querySelectorAll('.chip'),function(x){x.classList.remove('on')});
    b.classList.add('on'); state.cat=Number(b.getAttribute('data-cat')); apply();
  })}
  if(sorts){sorts.addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b)return;
    Array.prototype.forEach.call(sorts.querySelectorAll('button'),function(x){x.classList.remove('on')});
    b.classList.add('on'); state.sort=b.getAttribute('data-sort'); apply();
  })}
  apply();
})();
`;

// ============================== 主流程 ==============================
async function main() {
  const t0 = Date.now();
  const outDir = path.resolve(CONFIG.outDir);

  console.log(`[1/5] 拉取分类 …`);
  const categories = await loadCategories();
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  console.log(`    ✓ ${categories.length} 个分类`);

  console.log(`[2/5] 拉取商品列表 …`);
  const raw = await loadCommodities();
  console.log(`    ✓ ${raw.length} 个商品`);

  console.log(`[3/5] 抓取商品详情（规格/库存/说明）…`);
  const details = await pool(
    raw,
    CONFIG.concurrency,
    (p) => fetchText(`${CONFIG.base}/item/${p.id}`).then(parseItemPage),
    (d, t) => process.stdout.write(`\r    ${d}/${t}`)
  );
  process.stdout.write('\n');

  const products = raw
    .map((p, i) => {
      const d = details[i] || {};
      const variants = d.variants || [];
      const basePrice = Number(p.price) || 0;
      const variantPrices = variants.map((v) => v.price).filter((n) => Number.isFinite(n) && n > 0);
      // 主价用官方起价（列表接口的 price 字段最准），区间上限取真实规格里的最高价
      const min = basePrice > 0 ? basePrice : variantPrices.length ? Math.min(...variantPrices) : 0;
      const max = Math.max(min, ...(variantPrices.length ? variantPrices : [min]));
      return {
        id: Number(p.id),
        name: String(p.name || ''),
        cover: p.cover || '',
        tagsList: Array.isArray(p.tags_list) ? p.tags_list : [],
        tags: p.tags || '',
        stock: p.stock || '',
        stockState: Number(p.stock_state) || 0,
        sold: Number(d.sold != null ? d.sold : p.order_sold) || 0,
        deliveryWay: Number(p.delivery_way) || 0,
        catId: Number(p.category_id) || 0,
        catName: (p.category && p.category.name) || catMap.get(Number(p.category_id)) || 'AI 会员',
        displayCats: Array.isArray(p.display_category_ids) ? p.display_category_ids.map(Number) : [],
        min,
        max,
        variants,
        desc: d.desc || '',
      };
    })
    // 过滤掉上游的测试商品 / 异常低价商品
    .filter((p) => !CONFIG.excludeCategoryIds.includes(p.catId))
    .filter((p) => !/测试|test/i.test(p.name))
    .filter((p) => p.min > 0.5);

  // 详情页缺失的兜底：正文用一句生成的原创描述
  for (const p of products) {
    if (!p.desc) {
      p.desc = `${p.name}。当前价格区间 ¥${money(p.min)} - ¥${money(p.max)}${p.sold ? `，累计已售 ${fmtSold(p.sold)}` : ''}。具体规格、库存与售后条款请以下单页为准。`;
    }
  }

  products.sort((a, b) => b.sold - a.sold);

  const builtAt = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  console.log(`[4/5] 生成页面 …`);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outDir, 'assets'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'p'), { recursive: true });

  await fs.writeFile(path.join(outDir, 'assets/style.css'), CSS, 'utf8');
  await fs.writeFile(path.join(outDir, 'assets/app.js'), APP_JS, 'utf8');
  await fs.writeFile(
    path.join(outDir, 'index.html'),
    renderIndex(products, categories, builtAt),
    'utf8'
  );
  await fs.writeFile(
    path.join(outDir, 'guide.html'),
    renderGuide(products, builtAt),
    'utf8'
  );

  // 商品详情页 + 相关推荐
  for (const p of products) {
    const related = products
      .filter((x) => x.id !== p.id && x.catId === p.catId)
      .slice(0, 6);
    const fallback = products.filter((x) => x.id !== p.id).slice(0, 6);
    const rel = (related.length ? related : fallback).slice(0, 6);
    await fs.writeFile(
      path.join(outDir, 'p', `${p.id}.html`),
      renderItem(p, rel, builtAt, categories),
      'utf8'
    );
  }

  // sitemap + robots
  const urls = [
    `${CONFIG.siteUrl}/`,
    `${CONFIG.siteUrl}/guide.html`,
    ...products.map((p) => `${CONFIG.siteUrl}/p/${p.id}.html`),
  ];
  const today = new Date().toISOString().slice(0, 10);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u, i) =>
      `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>${i < 2 ? 'daily' : 'weekly'}</changefreq><priority>${i === 0 ? '1.0' : i < 2 ? '0.8' : '0.6'}</priority></url>`
  )
  .join('\n')}
</urlset>
`;
  await fs.writeFile(path.join(outDir, 'sitemap.xml'), sitemap, 'utf8');
  await fs.writeFile(
    path.join(outDir, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${CONFIG.siteUrl}/sitemap.xml\n`,
    'utf8'
  );

  // IndexNow 密钥文件（放在站点根目录，用于向 Bing/Yandex 自动提交页面）
  if (CONFIG.indexNowKey) {
    await fs.writeFile(
      path.join(outDir, `${CONFIG.indexNowKey}.txt`),
      CONFIG.indexNowKey,
      'utf8'
    );
  }

  // 构建元信息（供自动化脚本/内容生成使用）
  await fs.writeFile(
    path.join(outDir, 'build-meta.json'),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        siteUrl: CONFIG.siteUrl,
        productCount: products.length,
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          cat: p.catName,
          min: p.min,
          max: p.max,
          sold: p.sold,
          stockState: p.stockState,
        })),
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`[5/5] 完成 ✅`);
  console.log(`    输出目录: ${outDir}`);
  console.log(`    页面数: ${1 + 1 + products.length} 个 HTML`);
  console.log(`    耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`\n下一步：把 ${CONFIG.outDir} 文件夹整个上传到静态托管即可。`);
}

main().catch((err) => {
  console.error('\n构建失败：', err);
  process.exit(1);
});
