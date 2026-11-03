'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_DIR = __dirname;
const DATA_FILE = process.env.STARMEMORY_DATA_FILE
  ? path.resolve(process.env.STARMEMORY_DATA_FILE)
  : path.join(DASHBOARD_DIR, 'data', 'dashboard.json');
const ANALYTICS_DIR = process.env.STARMEMORY_ANALYTICS_DIR
  ? path.resolve(process.env.STARMEMORY_ANALYTICS_DIR)
  : path.join(ROOT, 'analytics');
const DRAFTS_DIR = path.join(ROOT, 'content', 'drafts');
const MAX_BODY = 1024 * 1024;
const NOTE_STATUSES = new Set(['idea', 'drafting', 'visual_pending', 'review_pending', 'approved', 'scheduled', 'published', 'archived']);
const PRODUCT_STATUSES = new Set(['spec_ready', 'sample_ready', 'testing', 'paused']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8'
};

let mutationQueue = Promise.resolve();

function readData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.notes) || !Array.isArray(data.tasks) || !Array.isArray(data.products) || !Array.isArray(data.analytics)) {
    throw new Error('Dashboard data schema is invalid.');
  }
  return data;
}

function writeAtomic(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, file);
}

function writeData(data) {
  data.meta = data.meta || {};
  data.meta.updatedAt = new Date().toISOString();
  writeAtomic(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
}

function mutateData(mutator) {
  const operation = mutationQueue.catch(() => undefined).then(() => {
    const data = readData();
    const result = mutator(data);
    writeData(data);
    return result;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON 格式无效'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

function nonNegativeInt(value, field, required = false) {
  if (value === '' || value === null || value === undefined) {
    if (required) throw Object.assign(new Error(field + ' 必须填写，没有发生请填0'), { status: 400 });
    return 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 99999999) throw Object.assign(new Error(`${field} 必须是非负数字`), { status: 400 });
  return Math.round(n);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validUrl(value) {
  if (!value) return '';
  const text = cleanText(value, 1000);
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function safeWithin(base, candidate) {
  const resolvedBase = path.resolve(base) + path.sep;
  const resolved = path.resolve(candidate);
  return resolved.startsWith(resolvedBase);
}

function isoWeekParts(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function aggregate(records) {
  const fields = ['impressions', 'likes', 'collects', 'comments', 'followersGained', 'inquiries', 'quotes', 'orders'];
  const totals = Object.fromEntries(fields.map(f => [f, 0]));
  for (const record of records) for (const f of fields) totals[f] += Number(record[f] || 0);
  return totals;
}

function buildWeeklyReport({ weekStart, weekEnd, observations, risks, nextSteps, records, generatedAt }) {
  const { year, week } = isoWeekParts(weekStart);
  const weekLabel = `${year}-W${String(week).padStart(2, '0')}`;
  const totals = aggregate(records);
  const lines = [
    `# 周复盘 ${weekLabel}`,
    '',
    `- 周期：${weekStart} 至 ${weekEnd}`,
    `- 生成时间：${generatedAt}`,
    '- 数据来源：StarMemory 本地运营看板',
    `- 数据完整性：${records.length ? `已录入 ${records.length} 篇笔记的真实发布记录` : '无发布数据，本报告不补造数字'}`,
    '',
    '## 1. 数据总览',
    '',
    '| 指标 | 数值 |',
    '|---|---:|',
    `| 已录入笔记 | ${records.length} |`,
    `| 阅读/曝光 | ${totals.impressions} |`,
    `| 点赞 | ${totals.likes} |`,
    `| 收藏 | ${totals.collects} |`,
    `| 评论 | ${totals.comments} |`,
    `| 涨粉 | ${totals.followersGained} |`,
    `| 有效咨询 | ${totals.inquiries} |`,
    `| 人工报价 | ${totals.quotes} |`,
    `| 订单 | ${totals.orders} |`,
    '',
    '## 2. 发布明细',
    '',
    records.length ? '| 日期 | 笔记 | 阅读 | 点赞 | 收藏 | 评论 | 涨粉 | 咨询 | 报价 | 订单 |' : '本周无真实发布记录。',
    ...(records.length ? ['|---|---|---:|---:|---:|---:|---:|---:|---:|---:|'] : []),
    ...records.map(r => `| ${r.date} | ${String(r.noteTitle || r.noteId).replaceAll('|','/')} | ${r.impressions || 0} | ${r.likes || 0} | ${r.collects || 0} | ${r.comments || 0} | ${r.followersGained || 0} | ${r.inquiries || 0} | ${r.quotes || 0} | ${r.orders || 0} |`),
    '',
    '## 3. 人工观察',
    '',
    observations || '本周未填写人工观察。',
    '',
    '## 4. 风险与阻塞',
    '',
    risks || '本周未填写风险与阻塞。',
    '',
    '## 5. 下周动作',
    '',
    nextSteps || '本周未填写下周动作。',
    '',
    '## 6. 数据完整性说明',
    '',
    '- 本报告由本地看板真实记录自动汇总；',
    '- 未发生的数据记为 0，未获取的字段应保持为空；',
    '- 本报告不包含自动发布、自动互动或虚构运营数据；',
    '- 阅读、点赞、收藏、评论等字段按用户录入的平台后台口径统计。',
    ''
  ];
  return { weekLabel, content: lines.join('\n') };
}

function serveFile(res, file, cache = 'no-store') {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

async function handleApi(req, res, pathname) {
  const method = req.method || 'GET';

  if (method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true, mode: 'local', host: HOST, port: PORT, updatedAt: readData().meta?.updatedAt || null });
  }

  if (method === 'GET' && pathname === '/api/dashboard') {
    return json(res, 200, readData());
  }

  if (method === 'GET' && pathname.startsWith('/api/drafts/')) {
    const id = decodeURIComponent(pathname.split('/').pop());
    const data = readData();
    const note = data.notes.find(n => n.id === id);
    if (!note || !note.file) return json(res, 404, { error: '该笔记还没有可读取的草稿文件' });
    const file = path.resolve(ROOT, note.file);
    if (!safeWithin(DRAFTS_DIR, file) || path.extname(file).toLowerCase() !== '.md') return json(res, 400, { error: '草稿路径无效' });
    if (!fs.existsSync(file)) return json(res, 404, { error: '草稿文件不存在' });
    return json(res, 200, { id, file: note.file, content: fs.readFileSync(file, 'utf8') });
  }

  if (method === 'PATCH' && pathname.startsWith('/api/notes/')) {
    const id = decodeURIComponent(pathname.split('/').pop());
    const body = await readBody(req);
    if (!NOTE_STATUSES.has(body.status)) return json(res, 400, { error: '笔记状态无效' });
    if (body.status === 'published') return json(res, 400, { error: '不能直接标记已发布，请先录入真实发布数据。' });
    const result = await mutateData(data => {
      const note = data.notes.find(n => n.id === id);
      if (!note) throw Object.assign(new Error('笔记不存在'), { status: 404 });
      note.status = body.status;
      note.statusChangedAt = new Date().toISOString();
      return note;
    });
    return json(res, 200, { ok: true, note: result });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/notes/')) {
    const id = decodeURIComponent(pathname.split('/').pop());
    const result = await mutateData(data => {
      const index = data.notes.findIndex(n => n.id === id);
      if (index === -1) throw Object.assign(new Error('笔记不存在或已被删除'), { status: 404 });
      const note = data.notes[index];
      if (note.status === 'published' || data.analytics.some(record => record.noteId === id)) {
        throw Object.assign(new Error('已发布或有真实数据的笔记不能删除，以保护运营记录。'), { status: 409 });
      }
      const archived = {
        ...note,
        originalStatus: note.status,
        deletedAt: new Date().toISOString(),
        deletionScope: 'dashboard_only'
      };
      data.notesArchive = Array.isArray(data.notesArchive) ? data.notesArchive : [];
      data.notesArchive.unshift(archived);
      data.notes.splice(index, 1);
      return { noteId: id, archived, draftPreserved: Boolean(note.file) };
    });
    return json(res, 200, { ok: true, ...result });
  }

  if (method === 'PATCH' && pathname.startsWith('/api/tasks/')) {
    const id = decodeURIComponent(pathname.split('/').pop());
    const body = await readBody(req);
    if (!['todo', 'done'].includes(body.status)) return json(res, 400, { error: '任务状态无效' });
    const result = await mutateData(data => {
      const task = data.tasks.find(t => t.id === id);
      if (!task) throw Object.assign(new Error('任务不存在'), { status: 404 });
      task.status = body.status;
      task.completedAt = body.status === 'done' ? new Date().toISOString() : null;
      return task;
    });
    return json(res, 200, { ok: true, task: result });
  }

  if (method === 'PATCH' && pathname.startsWith('/api/products/')) {
    const id = decodeURIComponent(pathname.split('/').pop());
    const body = await readBody(req);
    if (body.status && !PRODUCT_STATUSES.has(body.status)) return json(res, 400, { error: '产品状态无效' });
    const result = await mutateData(data => {
      const product = data.products.find(p => p.id === id);
      if (!product) throw Object.assign(new Error('产品不存在'), { status: 404 });
      if (body.status) product.status = body.status;
      for (const key of ['launchTestPriceCny', 'standardTestPriceCny']) {
        if (body[key] !== undefined) {
          const n = Number(body[key]);
          if (!Number.isFinite(n) || n < 0 || n > 99999) throw Object.assign(new Error('价格无效'), { status: 400 });
          product[key] = Math.round(n * 100) / 100;
        }
      }
      for (const key of ['inquiries', 'quotes', 'orders']) {
        if (body[key] !== undefined) product[key] = nonNegativeInt(body[key], key);
      }
      return product;
    });
    return json(res, 200, { ok: true, product: result });
  }

  if (method === 'POST' && pathname.startsWith('/api/products/') && pathname.endsWith('/feedback')) {
    const id = decodeURIComponent(pathname.split('/')[3]);
    const body = await readBody(req);
    const text = cleanText(body.text, 500);
    if (!text) return json(res, 400, { error: '反馈内容不能为空' });
    const result = await mutateData(data => {
      const product = data.products.find(p => p.id === id);
      if (!product) throw Object.assign(new Error('产品不存在'), { status: 404 });
      const feedback = {
        id: `F${crypto.randomBytes(3).toString('hex')}`,
        date: new Date().toISOString().slice(0, 10),
        text,
        sentiment: ['positive', 'neutral', 'negative'].includes(body.sentiment) ? body.sentiment : 'neutral',
        consentToUse: Boolean(body.consentToUse)
      };
      product.userFeedback = product.userFeedback || [];
      product.userFeedback.push(feedback);
      return feedback;
    });
    return json(res, 201, { ok: true, feedback: result });
  }

  if (method === 'POST' && pathname === '/api/analytics') {
    const body = await readBody(req);
    const noteId = cleanText(body.noteId, 20);
    const date = cleanText(body.date, 10);
    const url = validUrl(body.url);
    if (!validDate(date)) return json(res, 400, { error: '请填写真实的发布日期' });
    if (!url) return json(res, 400, { error: '请填写真实的小红书笔记链接' });
    const metrics = {
      impressions: nonNegativeInt(body.impressions, '阅读/曝光', true),
      likes: nonNegativeInt(body.likes, '点赞', true),
      collects: nonNegativeInt(body.collects, '收藏', true),
      comments: nonNegativeInt(body.comments, '评论', true),
      followersGained: nonNegativeInt(body.followersGained, '涨粉', true),
      inquiries: nonNegativeInt(body.inquiries, '有效咨询', true),
      quotes: nonNegativeInt(body.quotes, '报价', true),
      orders: nonNegativeInt(body.orders, '订单', true)
    };
    const result = await mutateData(data => {
      const note = data.notes.find(n => n.id === noteId);
      if (!note) throw Object.assign(new Error('笔记不存在'), { status: 404 });
      let record = data.analytics.find(r => r.noteId === noteId);
      const now = new Date().toISOString();
      if (!record) {
        record = { id: `R${crypto.randomBytes(4).toString('hex')}`, noteId, createdAt: now };
        data.analytics.push(record);
      }
      Object.assign(record, {
        date,
        publishTime: cleanText(body.publishTime, 10),
        url,
        noteTitle: note.title,
        ...metrics,
        notes: cleanText(body.notes, 500),
        updatedAt: now
      });
      note.status = 'published';
      note.publishedAt = date;
      return record;
    });
    return json(res, 201, { ok: true, record: result });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/analytics/')) {
    const id = decodeURIComponent(pathname.split('/').pop());
    const result = await mutateData(data => {
      const index = data.analytics.findIndex(r => r.id === id);
      if (index === -1) throw Object.assign(new Error('数据记录不存在'), { status: 404 });
      const [removed] = data.analytics.splice(index, 1);
      const note = data.notes.find(n => n.id === removed.noteId);
      if (note && !data.analytics.some(r => r.noteId === note.id)) {
        note.status = 'approved';
        note.publishedAt = null;
      }
      return removed;
    });
    return json(res, 200, { ok: true, removed: result });
  }

  if (method === 'POST' && pathname === '/api/reports/weekly') {
    const body = await readBody(req);
    const weekStart = cleanText(body.weekStart, 10);
    const weekEnd = cleanText(body.weekEnd, 10);
    if (!validDate(weekStart) || !validDate(weekEnd) || weekStart > weekEnd) return json(res, 400, { error: '周报日期区间无效' });
    const observations = cleanText(body.observations, 3000);
    const risks = cleanText(body.risks, 3000);
    const nextSteps = cleanText(body.nextSteps, 3000);
    const generatedAt = new Date().toISOString();
    const result = await mutateData(data => {
      const records = data.analytics.filter(r => r.date >= weekStart && r.date <= weekEnd).sort((a, b) => a.date.localeCompare(b.date));
      const report = buildWeeklyReport({ weekStart, weekEnd, observations, risks, nextSteps, records, generatedAt });
      const filename = `weekly-review-${report.weekLabel}.md`;
      const file = path.join(ANALYTICS_DIR, filename);
      writeAtomic(file, report.content);
      data.review = {
        weekLabel: report.weekLabel,
        baseline: false,
        latestReportPath: `analytics/${filename}`,
        observations,
        risks,
        nextSteps,
        generatedAt
      };
      return { ...report, path: `analytics/${filename}`, records: records.length };
    });
    return json(res, 201, { ok: true, ...result });
  }

  if (method === 'GET' && pathname === '/api/reports/latest') {
    const data = readData();
    const relative = data.review?.latestReportPath;
    if (!relative) return json(res, 404, { error: '尚无周报' });
    const file = path.join(ANALYTICS_DIR, path.basename(relative));
    if (!safeWithin(ANALYTICS_DIR, file)) return json(res, 400, { error: '周报路径无效' });
    if (!fs.existsSync(file)) return json(res, 404, { error: '周报文件不存在' });
    return json(res, 200, { path: relative, content: fs.readFileSync(file, 'utf8') });
  }

  return json(res, 404, { error: 'API 不存在' });
}

function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    return res.end('Method Not Allowed');
  }
  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(DASHBOARD_DIR, 'index.html'));
  }
  if (pathname === '/style.css') return serveFile(res, path.join(DASHBOARD_DIR, 'style.css'));
  if (pathname === '/app.js') return serveFile(res, path.join(DASHBOARD_DIR, 'app.js'));
  if (pathname === '/favicon.ico') return serveFile(res, path.join(ROOT, 'config', 'brand', 'avatar.svg'), 'public, max-age=3600');
  if (pathname.startsWith('/content/images/') || pathname.startsWith('/config/brand/') || pathname.startsWith('/products/fan-journal-template/')) {
    const file = path.resolve(ROOT, `.${decodeURIComponent(pathname)}`);
    const allowed = safeWithin(path.join(ROOT, 'content', 'images'), file) || safeWithin(path.join(ROOT, 'config', 'brand'), file) || safeWithin(path.join(ROOT, 'products', 'fan-journal-template'), file);
    if (allowed && serveFile(res, file, 'public, max-age=3600')) return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'");
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || HOST}`);
    const pathname = decodeURIComponent(parsed.pathname);
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return handleStatic(req, res, pathname);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) json(res, status, { error: error.message || '服务器内部错误' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`StarMemory dashboard: http://${HOST}:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log('Local only. No auto-publish, auto-engagement, or credential storage.');
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
