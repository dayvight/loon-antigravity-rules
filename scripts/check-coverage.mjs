#!/usr/bin/env node
/**
 * 覆盖缺口校验
 * 每天确认 Antigravity / Google 登录链路的关键域名，是否仍被
 * 上游规则集（kelee AI.lsr、VPSDance ai-proxy-rules）或本仓库补充规则覆盖。
 * 发现无人覆盖的域名就开 issue。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DRY_RUN = process.env.DRY_RUN === '1';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || 'dayvight/loon-antigravity-rules';
const ISSUE_PREFIX = '[coverage-gap]';
const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY || '';

const UPSTREAMS = [
  {
    name: 'kelee AI.lsr',
    snapshot: 'upstream/kelee-ai.list',
    urls: [
      'https://kelee.one/Tool/Loon/Lsr/AI.lsr',
      'https://rule.kelee.one/Tool/Loon/Lsr/AI.lsr',
    ],
  },
  {
    name: 'VPSDance global.list',
    snapshot: 'upstream/vpsdance-global.list',
    urls: [
      'https://cdn.jsdelivr.net/gh/VPSDance/ai-proxy-rules@main/rules/loon/global.list',
      'https://raw.githubusercontent.com/VPSDance/ai-proxy-rules/main/rules/loon/global.list',
    ],
  },
];

const LOCAL_RULES = 'rules/google-auth.list';

const TARGETS = [
  ['antigravity.google', 'Antigravity 主域'],
  ['antigravity-unleash.goog', 'Antigravity 特性开关'],
  ['antigravity-pa.googleapis.com', 'Antigravity 后端'],
  ['antigravity.googleapis.com', 'Antigravity 后端'],
  ['accounts.google.com', 'OAuth 登录必经'],
  ['myaccount.google.com', '账号页 / ToS 国家'],
  ['ogs.google.com', '登录页服务菜单'],
  ['apis.google.com', 'Google 账号框架'],
  ['clients6.google.com', '登录页伴随请求'],
  ['content-autofill.googleapis.com', '登录表单填充'],
  ['oauth2.googleapis.com', 'token 刷新'],
  ['www.googleapis.com', '通用 API'],
  ['storage.googleapis.com', '安装包 / 素材'],
  ['cloudcode-pa.googleapis.com', 'Antigravity 主 API'],
  ['daily-cloudcode-pa.googleapis.com', 'Antigravity 主 API daily'],
  ['daily-cloudcode-pa.sandbox.googleapis.com', 'Antigravity 沙箱'],
  ['aida.googleapis.com', 'Gemini 后端'],
  ['aiplatform.googleapis.com', 'Vertex AI'],
  ['generativelanguage.googleapis.com', 'Gemini API'],
  ['lh3.googleusercontent.com', '头像 / 图片'],
  ['ssl.gstatic.com', '静态资源'],
  ['www.google.com', 'Google 主站'],
  ['play.google.com', 'Play'],
  ['mail.google.com', 'Gmail'],
];

function parseRules(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const m = line.match(/^(DOMAIN-SUFFIX|DOMAIN-KEYWORD|DOMAIN)\s*,\s*(.+)$/i);
    if (!m) continue;
    const value = m[2].split(',')[0].trim().toLowerCase();
    if (value) out.push({ type: m[1].toUpperCase(), value });
  }
  return out;
}

function isCovered(domain, rules) {
  const d = domain.toLowerCase();
  for (const r of rules) {
    if (r.type === 'DOMAIN' && d === r.value) return true;
    if (r.type === 'DOMAIN-SUFFIX' && (d === r.value || d.endsWith('.' + r.value))) return true;
    if (r.type === 'DOMAIN-KEYWORD' && d.includes(r.value)) return true;
  }
  return false;
}

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (coverage-check)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, status: res.status, text: '' };
    return { ok: true, status: res.status, text: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, text: '', error: String(err) };
  }
}

async function loadUpstream(spec) {
  for (const url of spec.urls) {
    const r = await fetchText(url);
    if (r.ok && r.text.trim().length > 0) {
      const snapPath = path.join(ROOT, spec.snapshot);
      await mkdir(path.dirname(snapPath), { recursive: true });
      await writeFile(snapPath, r.text);
      return { ...spec, source: 'live', url, text: r.text };
    }
  }
  const snapPath = path.join(ROOT, spec.snapshot);
  if (existsSync(snapPath)) {
    return { ...spec, source: 'snapshot', url: spec.snapshot, text: await readFile(snapPath, 'utf8') };
  }
  return { ...spec, source: 'missing', url: '', text: '' };
}

async function ghApi(method, endpoint, body) {
  const res = await fetch('https://api.github.com' + endpoint, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'coverage-check',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  return { ok: res.ok, status: res.status, json, text };
}

async function main() {
  const localPath = path.join(ROOT, LOCAL_RULES);
  if (!existsSync(localPath)) throw new Error('缺少本地规则集: ' + LOCAL_RULES);
  const localText = await readFile(localPath, 'utf8');

  const loaded = [];
  for (const spec of UPSTREAMS) loaded.push(await loadUpstream(spec));

  const allRules = [];
  const perSet = {};
  for (const u of loaded) {
    const rules = parseRules(u.text);
    perSet[u.name] = rules;
    allRules.push(...rules);
  }
  const localRules = parseRules(localText);
  allRules.push(...localRules);

  const gaps = [];
  const covered = [];
  for (const pair of TARGETS) {
    if (isCovered(pair[0], allRules)) covered.push(pair);
    else gaps.push(pair);
  }

  const missingUpstreams = loaded.filter((u) => u.source === 'missing').map((u) => u.name);
  const staleUpstreams = loaded.filter((u) => u.source === 'snapshot').map((u) => u.name);

  const lines = [];
  lines.push('## 覆盖缺口校验结果');
  lines.push('');
  lines.push('| 规则集 | 拉取状态 | 规则数 |');
  lines.push('| --- | --- | --- |');
  for (const u of loaded) {
    const status = u.source === 'live' ? '在线' : u.source === 'snapshot' ? '回退快照' : '不可用';
    lines.push('| ' + u.name + ' | ' + status + ' | ' + (perSet[u.name] || []).length + ' |');
  }
  lines.push('| 本仓库补充规则 | - | ' + localRules.length + ' |');
  lines.push('');
  lines.push('**关键域名覆盖：' + covered.length + ' / ' + TARGETS.length + '**');
  lines.push('');
  if (gaps.length) {
    lines.push('### 未覆盖域名');
    lines.push('');
    lines.push('| 域名 | 说明 |');
    lines.push('| --- | --- |');
    for (const g of gaps) lines.push('| ' + g[0] + ' | ' + g[1] + ' |');
  } else {
    lines.push('所有关键域名均已被覆盖。');
  }

  const summary = lines.join('\n');
  console.log(summary);
  if (SUMMARY_FILE) await writeFile(SUMMARY_FILE, summary + '\n', { flag: 'a' });

  if (gaps.length === 0) return;
  if (DRY_RUN) { console.log('[DRY_RUN] skip issue'); return; }
  if (!TOKEN) { console.log('[WARN] no GITHUB_TOKEN, skip issue'); return; }

  const openIssues = await ghApi('GET', '/repos/' + REPO + '/issues?state=open&per_page=100');
  const existing = (openIssues.json || []).find(
    (i) => typeof i.title === 'string' && i.title.indexOf(ISSUE_PREFIX) === 0
  );
  const title = ISSUE_PREFIX + ' 检测到 ' + gaps.length + ' 个未被任何规则集覆盖的域名';

  const bodyParts = [
    '自动校验发现以下域名不在任何一份规则集的覆盖范围内：',
    '',
    '| 域名 | 说明 |',
    '| --- | --- |',
  ];
  for (const g of gaps) bodyParts.push('| ' + g[0] + ' | ' + g[1] + ' |');
  bodyParts.push('', '### 上游状态', '');
  for (const u of loaded) {
    bodyParts.push('- ' + u.name + '：' + (u.source === 'live' ? '在线' : u.source === 'snapshot' ? '回退快照' : '不可用'));
  }
  bodyParts.push('', '### 建议补充的规则', '');
  for (const g of gaps) bodyParts.push('    DOMAIN,' + g[0]);
  bodyParts.push('', '补进 ' + LOCAL_RULES + ' 并提交即可关闭本 issue。');
  if (missingUpstreams.length) bodyParts.push('', '> 上游不可用：' + missingUpstreams.join('、'));
  if (staleUpstreams.length) bodyParts.push('> 使用快照的上游：' + staleUpstreams.join('、'));

  const body = bodyParts.join('\n');

  if (existing) {
    const r = await ghApi('PATCH', '/repos/' + REPO + '/issues/' + existing.number, { title, body });
    console.log(r.ok ? 'updated issue #' + existing.number : 'update failed: ' + r.text.slice(0, 200));
  } else {
    const r = await ghApi('POST', '/repos/' + REPO + '/issues', { title, body });
    console.log(r.ok ? 'created issue #' + (r.json && r.json.number) : 'create failed: ' + r.text.slice(0, 200));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
