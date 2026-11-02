'use strict';

const viewRoot = document.getElementById('view-root');
const pageTitle = document.getElementById('page-title');
const pageKicker = document.getElementById('page-kicker');
const connectionEl = document.getElementById('connection');
const connectionText = document.getElementById('connection-text');
const modalEl = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalKicker = document.getElementById('modal-kicker');
const modalBody = document.getElementById('modal-body');
const toastEl = document.getElementById('toast');

const VIEW_META = {
  overview: { title: '运营总览', kicker: 'STAR MEMORY / OPERATIONS' },
  notes: { title: '内容管理', kicker: 'CONTENT STUDIO / PIPELINE' },
  calendar: { title: '内容日历', kicker: '30-DAY PLAN / LOCAL' },
  products: { title: '产品管理', kicker: 'PRODUCT LAB / TESTING' },
  analytics: { title: '数据分析', kicker: 'REAL DATA / NO ESTIMATES' },
  review: { title: '运营复盘', kicker: 'WEEKLY REVIEW / LOCAL REPORT' }
};
const STATUS_META = {
  idea: { label: '待制作', className: 'status-idea' },
  drafting: { label: '制作中', className: 'status-drafting' },
  visual_pending: { label: '待视觉', className: 'status-visual_pending' },
  review_pending: { label: '待审核', className: 'status-review_pending' },
  approved: { label: '已批准', className: 'status-approved' },
  scheduled: { label: '已排期', className: 'status-scheduled' },
  published: { label: '已发布', className: 'status-published' },
  archived: { label: '已归档', className: 'status-archived' },
  spec_ready: { label: '规格就绪', className: 'status-spec_ready' },
  sample_ready: { label: '样品就绪', className: 'status-sample_ready' },
  testing: { label: '测试中', className: 'status-testing' },
  paused: { label: '暂停', className: 'status-paused' }
};
const PRODUCT_LABELS = {
  'birthday-poster': '生日纪念海报',
  'concert-collage': '演唱会回忆拼贴',
  'fan-journal-template': '粉丝手账模板',
  all: '综合内容'
};
const METRIC_KEYS = ['impressions', 'likes', 'collects', 'comments', 'followersGained', 'inquiries', 'quotes', 'orders'];
const state = {
  data: null,
  currentView: location.hash ? location.hash.slice(1) : 'overview',
  notesFilter: 'all',
  notesQuery: '',
  lastReportContent: null,
  toastTimer: null
};
if (!VIEW_META[state.currentView]) state.currentView = 'overview';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function escapeAttr(value) { return escapeHtml(value); }
function formatNumber(value) { return new Intl.NumberFormat('zh-CN').format(Number(value || 0)); }
function formatCurrency(value) {
  const n = Number(value || 0);
  return `¥${n.toFixed(n % 1 === 0 ? 0 : 1)}`;
}
function statusMeta(status) { return STATUS_META[status] || { label: status || '未知', className: 'status-archived' }; }
function statusBadge(status) {
  const meta = statusMeta(status);
  return `<span class="badge ${meta.className}">${escapeHtml(meta.label)}</span>`;
}
function productLabel(productId) { return PRODUCT_LABELS[productId] || productId || '未分类'; }
function noteById(id) { return state.data?.notes.find(note => note.id === id); }
function productById(id) { return state.data?.products.find(product => product.id === id); }
function dateObject(dateString) { return new Date(`${dateString}T12:00:00`); }
function formatDate(dateString, withWeekday = false) {
  if (!dateString) return '未排期';
  const date = dateObject(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', ...(withWeekday ? { weekday: 'short' } : {})
  }).format(date);
}
function formatFullDate(dateString) {
  if (!dateString) return '--';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(dateObject(dateString));
}
function localDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function nowLabel() {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
}
function sumMetrics(records) {
  const totals = Object.fromEntries(METRIC_KEYS.map(key => [key, 0]));
  for (const record of records) {
    for (const key of METRIC_KEYS) totals[key] += Number(record[key] || 0);
  }
  return totals;
}
function noteCounts() {
  const notes = state.data?.notes || [];
  const counts = { all: notes.length, production: 0, review: 0, approved: 0, published: 0 };
  for (const note of notes) {
    if (['idea', 'drafting', 'visual_pending'].includes(note.status)) counts.production += 1;
    if (note.status === 'review_pending') counts.review += 1;
    if (['approved', 'scheduled'].includes(note.status)) counts.approved += 1;
    if (note.status === 'published') counts.published += 1;
  }
  return counts;
}

function setConnection(mode) {
  connectionEl.classList.toggle('is-online', mode === 'online');
  connectionEl.classList.toggle('is-offline', mode === 'offline');
  connectionText.textContent = mode === 'online' ? '本地数据已连接' : mode === 'offline' ? '本地服务未连接' : '连接中';
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  toastEl.textContent = message;
  toastEl.classList.toggle('is-error', isError);
  toastEl.classList.add('is-visible');
  state.toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 3200);
}

async function api(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers });
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || '服务器返回了无法解析的内容' }; }
  if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload;
}

async function refreshData({ render = true } = {}) {
  const data = await api('/api/dashboard');
  state.data = data;
  updateSidebarMeta();
  if (render) renderView();
  return data;
}

function updateSidebarMeta() {
  const updated = state.data?.meta?.updatedAt;
  document.getElementById('sidebar-updated').textContent = updated
    ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(updated))
    : '--';
  document.getElementById('nav-note-count').textContent = state.data?.notes?.length || '0';
}

function renderView() {
  if (!state.data) return;
  const meta = VIEW_META[state.currentView] || VIEW_META.overview;
  pageTitle.textContent = meta.title;
  pageKicker.textContent = meta.kicker;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('is-active', item.dataset.view === state.currentView));
  history.replaceState(null, '', `#${state.currentView}`);
  if (state.currentView === 'overview') renderOverview();
  else if (state.currentView === 'notes') renderNotes();
  else if (state.currentView === 'calendar') renderCalendar();
  else if (state.currentView === 'products') renderProducts();
  else if (state.currentView === 'analytics') renderAnalytics();
  else renderReview();
}

function setView(view) {
  if (!VIEW_META[view]) return;
  state.currentView = view;
  renderView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showError(error) {
  setConnection('offline');
  viewRoot.innerHTML = `
    <div class="error-card">
      <strong>无法读取本地看板数据</strong>
      <p>${escapeHtml(error.message || '未知错误')}</p>
      <p>请在本机终端运行 <code>node dashboard/server.js</code>，再访问 <code>http://127.0.0.1:4173</code>。</p>
      <button class="button button-primary" type="button" id="retry-load">重新连接</button>
    </div>`;
  document.getElementById('retry-load')?.addEventListener('click', bootstrap);
}

function openModal(title, kicker, content) {
  modalTitle.textContent = title;
  modalKicker.textContent = kicker;
  modalBody.innerHTML = content;
  modalEl.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('modal-close')?.focus(), 20);
}
function closeModal() {
  modalEl.hidden = true;
  modalBody.innerHTML = '';
  document.body.style.overflow = '';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板');
  } catch {
    showToast('浏览器未允许剪贴板访问，请手动选择复制。', true);
  }
}

async function updateNoteStatus(noteId, status) {
  const note = noteById(noteId);
  if (!note) return;
  const labels = {
    approved: '批准这篇笔记',
    drafting: '退回为制作中',
    review_pending: '提交人工审核',
    scheduled: '标记为已排期',
    archived: '归档这篇笔记'
  };
  if (!window.confirm(`确认${labels[status] || '更新状态'}：${note.id}？\n此操作不会自动发布。`)) return;
  try {
    await api(`/api/notes/${encodeURIComponent(noteId)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    showToast(`${note.id} 已更新为「${statusMeta(status).label}」`);
    await refreshData();
    openNoteModal(noteId);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function openNoteModal(noteId) {
  const note = noteById(noteId);
  if (!note) return;
  const meta = statusMeta(note.status);
  openModal(note.title, `${note.id} / CONTENT DRAFT`, `
    <div class="draft-meta">
      ${statusBadge(note.status)}
      <span class="badge status-archived">${escapeHtml(formatFullDate(note.plannedDate))}</span>
      <span class="badge status-archived">${escapeHtml(productLabel(note.productId))}</span>
    </div>
    <p class="modal-note">${escapeHtml(note.pillar || '')}。状态仅为本地工作流，不代表平台审核或已发布。</p>
    <div id="draft-content"><div class="loading-card"><span class="loading-orbit"></span><div><strong>正在读取草稿</strong><p>${escapeHtml(note.file || '无草稿文件')}</p></div></div></div>
    <div class="modal-actions" id="draft-actions">
      <button class="button button-small" type="button" id="copy-draft" disabled>复制全文</button>
      ${note.status === 'review_pending' ? `<button class="button button-mint button-small" type="button" data-note-status="approved">批准，进入待发布</button><button class="button button-small" type="button" data-note-status="drafting">退回修改</button>` : ''}
      ${['idea', 'drafting', 'visual_pending'].includes(note.status) ? '<button class="button button-mint button-small" type="button" data-note-status="review_pending">提交人工审核</button>' : ''}
      ${note.status === 'approved' ? '<button class="button button-mint button-small" type="button" data-note-status="scheduled">标记为已排期</button>' : ''}
      ${note.status === 'scheduled' ? '<button class="button button-small" type="button" data-note-status="approved">退回待发布</button>' : ''}
      ${note.status === 'published' ? '<button class="button button-small" type="button" data-view-from-modal="analytics">查看数据录入</button>' : ''}
    </div>
  `);
  const contentHost = document.getElementById('draft-content');
  const copyButton = document.getElementById('copy-draft');
  let draftText = '';
  try {
    if (!note.file) throw new Error('这篇笔记还没有完整草稿文件。');
    const result = await api(`/api/drafts/${encodeURIComponent(note.id)}`);
    draftText = result.content;
    contentHost.innerHTML = `<pre class="draft-copy">${escapeHtml(result.content)}</pre>`;
    copyButton.disabled = false;
    copyButton.addEventListener('click', () => copyText(draftText));
  } catch (error) {
    contentHost.innerHTML = `<div class="empty-state"><strong>暂无完整草稿</strong><p>${escapeHtml(error.message)}</p><p>该内容槽仍处于待制作阶段，请先完成内容再提交审核。</p></div>`;
  }
  modalBody.querySelectorAll('[data-note-status]').forEach(button => {
    button.addEventListener('click', () => updateNoteStatus(note.id, button.dataset.noteStatus));
  });
  modalBody.querySelector('[data-view-from-modal="analytics"]')?.addEventListener('click', () => { closeModal(); setView('analytics'); });
}

async function openProductModal(productId) {
  const product = productById(productId);
  if (!product) return;
  openModal(product.name, 'PRODUCT / LOCAL EDIT', `
    <div class="product-edit-summary"><strong>${escapeHtml(product.name)}</strong>${statusBadge(product.status)}</div>
    <form id="product-edit-form" class="form-grid">
      <div class="field"><label for="product-status">产品状态</label><select id="product-status" name="status">
        ${['spec_ready', 'sample_ready', 'testing', 'paused'].map(value => `<option value="${value}" ${product.status === value ? 'selected' : ''}>${statusMeta(value).label}</option>`).join('')}
      </select></div>
      <div class="field"><label for="product-standard-price">标准测试价（元）</label><input id="product-standard-price" name="standardTestPriceCny" type="number" min="0" step="0.1" value="${escapeAttr(product.standardTestPriceCny)}" required></div>
      <div class="field"><label for="product-launch-price">前 3 单验证价（元）</label><input id="product-launch-price" name="launchTestPriceCny" type="number" min="0" step="0.1" value="${escapeAttr(product.launchTestPriceCny)}" required></div>
      <div class="field"><label for="product-inquiries">有效咨询</label><input id="product-inquiries" name="inquiries" type="number" min="0" step="1" value="${escapeAttr(product.inquiries || 0)}" required></div>
      <div class="field"><label for="product-quotes">人工报价</label><input id="product-quotes" name="quotes" type="number" min="0" step="1" value="${escapeAttr(product.quotes || 0)}" required></div>
      <div class="field"><label for="product-orders">真实订单</label><input id="product-orders" name="orders" type="number" min="0" step="1" value="${escapeAttr(product.orders || 0)}" required></div>
      <div class="field-full"><div class="inline-note"><strong>数据纪律</strong><span>只记录已发生的真实咨询、报价和订单。未发生填 0，不用估算补全。</span></div></div>
      <div class="field-full"><div class="form-actions"><button class="button button-primary" type="submit">保存产品数据</button></div></div>
    </form>
    <div class="section-head" style="margin-top:24px"><div><p class="section-kicker">REAL FEEDBACK</p><h3 class="section-title">记录真实反馈</h3></div></div>
    <form id="feedback-form" class="form-grid" style="margin-top:14px">
      <div class="field field-full"><label for="feedback-text">用户原话 / 需求（去标识化）</label><textarea id="feedback-text" name="text" maxlength="500" placeholder="例如：用户主动询问能否只用票根做生日海报。" required></textarea></div>
      <div class="field"><label for="feedback-sentiment">反馈倾向</label><select id="feedback-sentiment" name="sentiment"><option value="neutral">中性</option><option value="positive">积极</option><option value="negative">消极</option></select></div>
      <div class="field"><label for="feedback-consent">是否允许公开引用</label><select id="feedback-consent" name="consentToUse"><option value="false">否</option><option value="true">是，已获同意</option></select></div>
      <div class="field-full"><div class="form-actions"><button class="button button-mint" type="submit">保存真实反馈</button></div></div>
    </form>
  `);
  document.getElementById('product-edit-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/products/${encodeURIComponent(product.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      showToast('产品数据已保存');
      await refreshData();
      openProductModal(product.id);
    } catch (error) { showToast(error.message, true); }
  });
  document.getElementById('feedback-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/products/${encodeURIComponent(product.id)}/feedback`, {
        method: 'POST',
        body: JSON.stringify({
          text: form.get('text'),
          sentiment: form.get('sentiment'),
          consentToUse: form.get('consentToUse') === 'true'
        })
      });
      showToast('真实反馈已保存');
      await refreshData();
      openProductModal(product.id);
    } catch (error) { showToast(error.message, true); }
  });
}

function renderOverview() {
  const counts = noteCounts();
  const totals = sumMetrics(state.data.analytics);
  const tasks = state.data.tasks || [];
  const doneTasks = tasks.filter(task => task.status === 'done').length;
  const recentNotes = [...state.data.notes].sort((a, b) => a.plannedDate.localeCompare(b.plannedDate)).slice(0, 6);
  const pendingReview = counts.review;
  const pipeline = [
    { label: '待制作', value: counts.production, cls: 'coral' },
    { label: '待审核', value: counts.review, cls: '' },
    { label: '待发布', value: counts.approved, cls: 'gold' },
    { label: '已发布', value: counts.published, cls: '' }
  ];
  const maxPipeline = Math.max(1, ...pipeline.map(item => item.value));

  viewRoot.innerHTML = `
    <div class="page-stack">
      <section class="overview-hero">
        <div class="hero-copy">
          <span class="hero-label">冷启动验证期 · 本地数据</span>
          <h2 class="hero-title">把喜欢变成<br><span>可交付的作品</span></h2>
          <p class="hero-desc">首批 10 篇内容已完成，正在等待人工审核。看板只负责整理工作流与真实数据，不自动发布、不自动互动，也不会替你编造增长。</p>
          <div class="hero-actions">
            <button class="button button-primary" type="button" data-action="jump-review">审核待发布内容</button>
            <button class="button button-ghost" type="button" data-action="jump-calendar">查看 30 天排期</button>
          </div>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <span class="hero-orbit"></span><span class="hero-orbit two"></span><span class="hero-star"></span>
          <div class="hero-counter">${String(pendingReview).padStart(2, '0')}<small>待人工审核</small></div>
        </div>
      </section>

      <section class="kpi-grid" aria-label="关键指标">
        ${kpiCard('待制作', counts.production, '内容槽', 'kpi-gold', '--')}
        ${kpiCard('待审核', counts.review, '需要你看', 'kpi-coral', '--')}
        ${kpiCard('已发布', counts.published, '真实状态', 'kpi-green', '--')}
        ${kpiCard('作品数量', state.data.artworks.length, '原创样品', 'kpi-violet', '--')}
        ${kpiCard('有效咨询', totals.inquiries, '真实录入', 'kpi-mint', '--')}
        ${kpiCard('真实订单', totals.orders, '非估算', 'kpi-blue', '--')}
      </section>

      <div class="dashboard-grid">
        <div class="stack">
          <section class="card">
            <div class="card-head">
              <div><h3>内容管线</h3><p>工作流状态用于团队协作，不代表平台审核结果</p></div>
              <span class="badge status-approved">${doneTasks}/${tasks.length} 本周任务完成</span>
            </div>
            <div class="card-body">
              <div class="pipeline-list">
                ${pipeline.map(item => `
                  <div class="pipeline-row">
                    <span class="pipeline-label">${item.label}</span>
                    <div class="pipeline-bar"><div class="pipeline-fill ${item.cls}" style="width:${Math.round(item.value / maxPipeline * 100)}%"></div></div>
                    <span class="pipeline-count">${item.value}</span>
                  </div>`).join('')}
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>近期内容</h3><p>按计划日期排序，点击可查看完整草稿与人工审核动作</p></div>
              <button class="button button-small" type="button" data-action="jump-all-notes">全部内容</button>
            </div>
            <div class="card-body">
              <div class="recent-list">
                ${recentNotes.map(note => `
                  <div class="recent-row">
                    <span class="recent-index">${escapeHtml(note.id.replace('N', ''))}</span>
                    <div><div class="recent-title">${escapeHtml(note.title)}</div><div class="recent-meta">${escapeHtml(formatDate(note.plannedDate, true))} · ${escapeHtml(productLabel(note.productId))}</div></div>
                    ${statusBadge(note.status)}
                  </div>`).join('')}
              </div>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card-head">
              <div><h3>本周任务</h3><p>勾选只更新本地进度，不会触发发布</p></div>
              <span class="mono muted">2026-W45</span>
            </div>
            <div class="card-body">
              <div class="task-list">
                ${tasks.map(task => `
                  <label class="task-row ${task.status === 'done' ? 'is-done' : ''}">
                    <input class="task-check" type="checkbox" data-task-id="${escapeAttr(task.id)}" ${task.status === 'done' ? 'checked' : ''}>
                    <span class="task-main">
                      <span class="task-title">${escapeHtml(task.title)}</span>
                      <span class="task-meta">
                        <span class="priority-${escapeAttr(task.priority)}">${escapeHtml(task.priority === 'critical' ? '关键' : task.priority === 'high' ? '高优先' : '常规')}</span>
                        <i class="task-dot"></i><span>${escapeHtml(task.owner)}</span><i class="task-dot"></i><span>${escapeHtml(formatFullDate(task.due))}</span>
                      </span>
                    </span>
                  </label>`).join('')}
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><div><h3>真实数据基线</h3><p>尚未发布前不生成虚假趋势</p></div><span class="badge status-idea">预发布</span></div>
            <div class="card-body">
              <div class="stat-row" style="grid-template-columns:repeat(2,1fr)">
                <div class="stat-tile"><b>${formatNumber(totals.impressions)}</b><span>阅读 / 曝光</span></div>
                <div class="stat-tile"><b>${formatNumber(totals.comments)}</b><span>真实评论</span></div>
                <div class="stat-tile"><b>${formatNumber(totals.quotes)}</b><span>人工报价</span></div>
                <div class="stat-tile"><b>${formatNumber(totals.orders)}</b><span>真实订单</span></div>
              </div>
              <p class="section-desc" style="margin-top:14px">录入第一条发布数据后，这里才会出现真实累计值。</p>
            </div>
          </section>
        </div>
      </div>

      <section class="card">
        <div class="card-head"><div><h3>原创作品样品</h3><p>6 张代码渲染原创海报 · 无明星肖像与官方素材</p></div><span class="badge status-spec_ready">1080 × 1440</span></div>
        <div class="card-body">
          <div class="artwork-strip">
            ${state.data.artworks.map(art => `<div class="artwork-thumb"><img src="${escapeAttr(art.url)}" alt="${escapeAttr(art.title)}" loading="lazy"><span>${escapeHtml(art.title)}</span></div>`).join('')}
          </div>
        </div>
      </section>
    </div>`;
}

function kpiCard(label, value, note, colorClass, serial) {
  return `<article class="kpi-card">
    <div class="kpi-top"><span class="kpi-icon ${colorClass}"><i></i></span><span class="kpi-note">${escapeHtml(serial)}</span></div>
    <div class="kpi-value">${formatNumber(value)}</div>
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-note" style="margin-top:5px">${escapeHtml(note)}</div>
  </article>`;
}

function filteredNotesList() {
  const query = state.notesQuery.trim().toLowerCase();
  return state.data.notes.filter(note => {
    let matchesStatus = true;
    if (state.notesFilter === 'production') matchesStatus = ['idea', 'drafting', 'visual_pending'].includes(note.status);
    if (state.notesFilter === 'review') matchesStatus = note.status === 'review_pending';
    if (state.notesFilter === 'approved') matchesStatus = ['approved', 'scheduled'].includes(note.status);
    if (state.notesFilter === 'published') matchesStatus = note.status === 'published';
    if (!matchesStatus) return false;
    if (!query) return true;
    return [note.id, note.title, note.pillar, productLabel(note.productId), ...(note.titleOptions || [])].join(' ').toLowerCase().includes(query);
  }).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
}

function notesGridHtml(notes) {
  if (!notes.length) {
    return `<div class="empty-state" style="grid-column:1/-1"><strong>没有匹配的内容</strong><p>调整筛选条件或搜索词，或从 30 天选题库中创建新的内容槽。</p></div>`;
  }
  return notes.map(note => {
    const searchKey = [note.id, note.title, note.pillar, productLabel(note.productId), ...(note.titleOptions || [])].join(' ').toLowerCase();
    const cover = note.coverUrl
      ? `<img src="${escapeAttr(note.coverUrl)}" alt="${escapeAttr(note.title)} 的封面样稿" loading="lazy">`
      : `<div class="note-cover-placeholder"><span class="cover-index">${escapeHtml(note.id.replace('N', ''))}</span><div class="cover-lines"><i></i><i></i><i></i></div><span class="cover-label">等待视觉制作</span></div>`;
    return `<article class="note-card" role="button" tabindex="0" data-note-card data-note-id="${escapeAttr(note.id)}" data-search="${escapeAttr(searchKey)}">
      <div class="note-cover">${cover}<div class="note-cover-overlay">${statusBadge(note.status)}</div></div>
      <div class="note-body">
        <div class="note-topline"><span class="note-id">${escapeHtml(note.id)}</span><span class="note-date">${escapeHtml(formatDate(note.plannedDate, true))}</span></div>
        <h3 class="note-title">${escapeHtml(note.title)}</h3>
        <div class="note-product">${escapeHtml(productLabel(note.productId))}</div>
        <div class="note-footer"><span class="muted" style="font-size:9px">${escapeHtml(note.pillar || '')}</span><span class="note-arrow">↗</span></div>
      </div>
    </article>`;
  }).join('');
}

function renderNotes() {
  const counts = noteCounts();
  const notes = filteredNotesList();
  const filters = [
    ['all', '全部', counts.all],
    ['production', '待制作', counts.production],
    ['review', '待审核', counts.review],
    ['approved', '待发布', counts.approved],
    ['published', '已发布', counts.published]
  ];
  viewRoot.innerHTML = `
    <div class="page-stack">
      <div class="section-head">
        <div><p class="section-kicker">CONTENT FACTORY</p><h2 class="section-title">内容与审核</h2><p class="section-desc">10 篇完整草稿待审核，10 个后续内容槽待制作。状态改变不代表已发布。</p></div>
        <div class="section-actions"><span class="badge status-review_pending">首批待人工审核</span></div>
      </div>
      <div class="toolbar">
        <div class="filter-tabs" role="group" aria-label="内容状态筛选">
          ${filters.map(([value, label, count]) => `<button class="filter-chip ${state.notesFilter === value ? 'is-active' : ''}" type="button" data-notes-filter="${value}">${label} · ${count}</button>`).join('')}
        </div>
        <label class="search-field" aria-label="搜索内容">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>
          <input id="notes-search" type="search" value="${escapeAttr(state.notesQuery)}" placeholder="搜索标题、编号或产品">
        </label>
      </div>
      <div class="section-head" style="margin-top:-7px">
        <p class="section-desc" style="margin:0">当前显示 <span id="notes-result-count">${notes.length}</span> 条</p>
        <p class="section-desc" style="margin:0">点击卡片查看完整草稿</p>
      </div>
      <div class="notes-grid" id="notes-grid">${notesGridHtml(notes)}</div>
    </div>`;
  document.querySelectorAll('[data-notes-filter]').forEach(button => {
    button.addEventListener('click', () => { state.notesFilter = button.dataset.notesFilter; renderNotes(); });
  });
  const search = document.getElementById('notes-search');
  search?.addEventListener('input', () => {
    state.notesQuery = search.value;
    const q = search.value.trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll('[data-note-card]').forEach(card => {
      const match = !q || (card.dataset.search || '').includes(q);
      card.hidden = !match;
      if (match) visible += 1;
    });
    const count = document.getElementById('notes-result-count');
    if (count) count.textContent = String(visible);
  });
}

function renderCalendar() {
  const notes = [...state.data.notes].sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
  const minDate = notes.length ? notes[0].plannedDate : '2026-11-04';
  const maxDate = notes.length ? notes[notes.length - 1].plannedDate : '2026-12-03';
  const start = dateObject(minDate);
  const end = dateObject(maxDate);
  const startOffset = (start.getDay() + 6) % 7;
  const totalDays = Math.round((end - start) / 86400000) + 1;
  const byDate = new Map();
  for (const note of notes) {
    if (!byDate.has(note.plannedDate)) byDate.set(note.plannedDate, []);
    byDate.get(note.plannedDate).push(note);
  }
  const today = localDateISO();
  const cells = [];
  for (let i = 0; i < startOffset; i += 1) cells.push('<div class="calendar-cell is-empty"></div>');
  for (let i = 0; i < totalDays; i += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = localDateISO(day);
    const dayNotes = byDate.get(iso) || [];
    const noteButtons = dayNotes.length
      ? dayNotes.map(note => `<button class="calendar-note" type="button" data-note-id="${escapeAttr(note.id)}"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;margin-right:5px;background:${statusColor(note.status)}"></span>${escapeHtml(note.title)}<small>${escapeHtml(note.id)} · ${escapeHtml(statusMeta(note.status).label)}</small></button>`).join('')
      : '<span class="calendar-empty-label">自由选题 / 互动观察</span>';
    cells.push(`<div class="calendar-cell ${iso === today ? 'is-today' : ''}">
      <div class="calendar-day"><strong>${day.getDate()}</strong><span>${day.getMonth() + 1}月 · ${['日','一','二','三','四','五','六'][day.getDay()]}</span></div>
      ${noteButtons}
    </div>`);
  }
  while (cells.length % 7 !== 0) cells.push('<div class="calendar-cell is-empty"></div>');
  viewRoot.innerHTML = `
    <div class="page-stack">
      <div class="section-head">
        <div><p class="section-kicker">30-DAY CONTENT CALENDAR</p><h2 class="section-title">计划不是发布记录</h2><p class="section-desc">以下日期来自 30 天计划。只有用户人工发布并录入真实链接后，状态才会进入已发布。</p></div>
        <div class="section-actions"><button class="button button-primary" type="button" data-action="jump-review">审核待发布内容</button></div>
      </div>
      <div class="card">
        <div class="card-body" style="padding-bottom:14px">
          <div class="calendar-legend">
            <span><i class="legend-dot" style="background:var(--amber)"></i>待制作</span>
            <span><i class="legend-dot" style="background:var(--coral)"></i>待审核</span>
            <span><i class="legend-dot" style="background:var(--mint)"></i>已批准 / 已排期</span>
            <span><i class="legend-dot" style="background:var(--green)"></i>已发布</span>
            <span class="muted">· 计划区间 ${escapeHtml(minDate)} 至 ${escapeHtml(maxDate)}</span>
          </div>
        </div>
        <div class="calendar-grid">
          ${['一','二','三','四','五','六','日'].map(day => `<div class="calendar-weekday">周${day}</div>`).join('')}
          ${cells.join('')}
        </div>
      </div>
    </div>`;
}

function statusColor(status) {
  if (['idea', 'drafting', 'visual_pending'].includes(status)) return 'var(--amber)';
  if (status === 'review_pending') return 'var(--coral)';
  if (['approved', 'scheduled'].includes(status)) return 'var(--mint)';
  if (status === 'published') return 'var(--green)';
  return 'var(--muted)';
}

function renderProducts() {
  const products = state.data.products || [];
  viewRoot.innerHTML = `
    <div class="page-stack">
      <div class="section-head">
        <div><p class="section-kicker">PRODUCT VALIDATION</p><h2 class="section-title">产品与测试价</h2><p class="section-desc">记录真实咨询、报价、订单与用户反馈。验证价只用于首批测试，不是长期定价。</p></div>
        <div class="section-actions"><span class="badge status-testing">数字交付 · 无实体库存</span></div>
      </div>
      <div class="products-grid">
        ${products.map((product, index) => {
          const feedback = product.userFeedback || [];
          return `<article class="product-card">
            <div class="product-top"><span class="product-icon">${String(index + 1).padStart(2, '0')}</span>${statusBadge(product.status)}</div>
            <h3 class="product-name">${escapeHtml(product.name)}</h3>
            <p class="product-desc">${escapeHtml(product.description)}</p>
            <div class="product-price-row">
              <div><div class="product-price">${formatCurrency(product.launchTestPriceCny)}<small> 起</small></div><div class="product-price-note">前 ${product.id === 'fan-journal-template' ? 'N' : '3'} 单验证价</div></div>
              <div style="margin-left:auto;text-align:right"><div class="product-price-note">标准测试价</div><div class="product-price" style="font-size:18px;margin-top:5px">${formatCurrency(product.standardTestPriceCny)}</div></div>
            </div>
            <div class="mini-metrics">
              <div class="mini-metric"><b>${formatNumber(product.inquiries)}</b><span>咨询</span></div>
              <div class="mini-metric"><b>${formatNumber(product.quotes)}</b><span>报价</span></div>
              <div class="mini-metric"><b>${formatNumber(product.orders)}</b><span>订单</span></div>
            </div>
            <div class="feedback-list">
              ${feedback.length ? feedback.slice(-2).map(item => `<div class="feedback-item">${escapeHtml(item.text)}<small>${escapeHtml(item.date)} · ${item.consentToUse ? '已同意引用' : '仅内部记录'}</small></div>`).join('') : '<div class="feedback-item muted">暂无真实用户反馈。禁止填写假设好评。<small>等待真实咨询或订单后记录</small></div>'}
            </div>
            <div class="product-footer">
              <span class="cost-note">估时 ${formatNumber(product.estimatedMinutes)} 分钟 · 估算成本 ${formatCurrency(product.estimatedCostCny)}</span>
              <span style="display:flex;gap:6px;flex-wrap:wrap"><a class="button button-small" href="${escapeAttr(product.sample || '')}" target="_blank" rel="noopener noreferrer">查看样品</a><button class="button button-small" type="button" data-product-edit="${escapeAttr(product.id)}">编辑产品</button></span>
            </div>
          </article>`;
        }).join('')}
      </div>
      <div class="inline-note"><strong>定价纪律</strong><span>验证价用于获取真实反馈，计算时已考虑学习期时间估值。没有真实订单前，不宣称“已验证需求”或“实现盈利”。</span></div>
    </div>`;
}

function renderAnalytics() {
  const totals = sumMetrics(state.data.analytics);
  const records = [...state.data.analytics].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const noteOptions = [...state.data.notes].sort((a, b) => a.id.localeCompare(b.id)).map(note => `<option value="${escapeAttr(note.id)}">${escapeHtml(note.id)} · ${escapeHtml(note.title)}（${escapeHtml(statusMeta(note.status).label)}）</option>`).join('');
  viewRoot.innerHTML = `
    <div class="page-stack">
      <div class="section-head">
        <div><p class="section-kicker">REAL DATA ONLY</p><h2 class="section-title">发布数据与商业漏斗</h2><p class="section-desc">只有真实发布后才能录入。同一篇笔记再次保存会更新该笔记的最新累计数据。</p></div>
        <div class="section-actions"><span class="badge status-approved">未估算 · 未补数</span></div>
      </div>
      <div class="stat-row" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat-tile"><b>${formatNumber(totals.impressions)}</b><span>阅读 / 曝光</span></div>
        <div class="stat-tile"><b>${formatNumber(totals.likes)}</b><span>点赞</span></div>
        <div class="stat-tile"><b>${formatNumber(totals.collects)}</b><span>收藏</span></div>
        <div class="stat-tile"><b>${formatNumber(totals.comments)}</b><span>评论</span></div>
      </div>
      <div class="analytics-hero">
        <section class="card"><div class="card-head"><div><h3>录入真实发布数据</h3><p>请按平台后台真实口径填写；未发生填 0</p></div><span class="badge status-idea">人工确认</span></div><div class="card-body">
          <form id="analytics-form" class="form-grid">
            <div class="field"><label for="analytics-note">对应笔记</label><select id="analytics-note" name="noteId" required>${noteOptions}</select></div>
            <div class="field"><label for="analytics-date">发布日期</label><input id="analytics-date" name="date" type="date" value="${localDateISO()}" required></div>
            <div class="field"><label for="analytics-time">发布时间</label><input id="analytics-time" name="publishTime" type="time"></div>
            <div class="field"><label for="analytics-url">真实笔记链接</label><input id="analytics-url" name="url" type="url" placeholder="https://www.xiaohongshu.com/..." required></div>
            ${[
              ['impressions','阅读 / 曝光'],['likes','点赞'],['collects','收藏'],['comments','评论'],
              ['followersGained','涨粉'],['inquiries','有效咨询'],['quotes','人工报价'],['orders','真实订单']
            ].map(([name, label]) => `<div class="field"><label for="analytics-${name}">${label}</label><input id="analytics-${name}" name="${name}" type="number" min="0" step="1" placeholder="必填，没有填 0" required></div>`).join('')}
            <div class="field-full"><label for="analytics-notes">人工备注（可选）</label><textarea id="analytics-notes" name="notes" maxlength="500" placeholder="例如：数据口径为平台后台 24 小时累计；评论多为票根场景。"></textarea></div>
            <div class="field-full"><div class="inline-note"><strong>发布确认</strong><span>提交即表示你确认该笔记已由人工真实发布，且数据来自平台后台。系统不会自动打开或操作小红书。</span></div></div>
            <div class="field-full"><div class="form-actions"><button class="button button-primary" type="submit">保存真实数据</button></div></div>
          </form>
        </div></section>
        <section class="card"><div class="card-head"><div><h3>商业漏斗</h3><p>从真实评论到真实订单</p></div></div><div class="card-body">
          <div class="stat-row" style="grid-template-columns:repeat(2,1fr)">
            <div class="stat-tile"><b>${formatNumber(totals.inquiries)}</b><span>有效咨询</span></div>
            <div class="stat-tile"><b>${formatNumber(totals.quotes)}</b><span>人工报价</span></div>
            <div class="stat-tile"><b>${formatNumber(totals.orders)}</b><span>真实订单</span></div>
            <div class="stat-tile"><b>${formatNumber(totals.followersGained)}</b><span>涨粉</span></div>
          </div>
          <p class="section-desc" style="margin-top:16px">不要把点赞、收藏或粉丝量推算成订单。无法确认的字段保持为空，不用估算补全。</p>
          <div class="inline-note danger-note" style="margin-top:16px"><strong>人工闸门</strong><span>任何发布、报价、付款、退款与账号授权都必须由你人工完成和确认。</span></div>
        </div></section>
      </div>
      <section class="card"><div class="card-head"><div><h3>真实发布记录</h3><p>共 ${records.length} 篇笔记的最新累计快照</p></div></div><div class="card-body">
        ${records.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>笔记</th><th>阅读</th><th>点赞</th><th>收藏</th><th>评论</th><th>涨粉</th><th>咨询</th><th>报价</th><th>订单</th><th>链接</th><th></th></tr></thead><tbody>
          ${records.map(record => `<tr><td>${escapeHtml(record.date)}</td><td>${escapeHtml(record.noteId)} · ${escapeHtml(record.noteTitle || '')}</td><td>${formatNumber(record.impressions)}</td><td>${formatNumber(record.likes)}</td><td>${formatNumber(record.collects)}</td><td>${formatNumber(record.comments)}</td><td>${formatNumber(record.followersGained)}</td><td>${formatNumber(record.inquiries)}</td><td>${formatNumber(record.quotes)}</td><td>${formatNumber(record.orders)}</td><td><a class="table-link" href="${escapeAttr(record.url)}" target="_blank" rel="noopener noreferrer">打开</a></td><td><button class="icon-button" type="button" title="删除误录" data-analytics-delete="${escapeAttr(record.id)}">×</button></td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty-state"><strong>还没有真实发布记录</strong><p>首批 10 篇仍处于待审核。人工发布后，再回到这里录入真实数据。</p></div>`}
      </div></section>
    </div>`;
  document.getElementById('analytics-form')?.addEventListener('submit', saveAnalytics);
}

async function saveAnalytics(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/analytics', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    showToast('真实发布数据已保存，该笔记状态已更新为已发布');
    await refreshData();
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
  }
}

function getWeekRange(reference = new Date()) {
  const date = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  const end = new Date(date);
  end.setDate(date.getDate() + 6);
  return { start: localDateISO(date), end: localDateISO(end) };
}

function renderReview() {
  const range = getWeekRange();
  const totals = sumMetrics(state.data.analytics);
  const review = state.data.review || {};
  viewRoot.innerHTML = `
    <div class="page-stack">
      <div class="section-head">
        <div><p class="section-kicker">WEEKLY OPERATIONS REVIEW</p><h2 class="section-title">用真实数据写周报</h2><p class="section-desc">系统只汇总本地录入记录。没有数据时，报告会明确写“无数据”，不会生成虚假结论。</p></div>
        <div class="section-actions"><span class="badge status-approved">${escapeHtml(review.weekLabel || 'BASELINE')}</span></div>
      </div>
      <div class="review-summary">
        <div class="stat-tile"><b>${state.data.analytics.length}</b><span>已录入发布记录</span></div>
        <div class="stat-tile"><b>${formatNumber(totals.inquiries)}</b><span>有效咨询</span></div>
        <div class="stat-tile"><b>${formatNumber(totals.orders)}</b><span>真实订单</span></div>
      </div>
      <div class="review-layout">
        <section class="card"><div class="card-head"><div><h3>生成周复盘</h3><p>人工观察 + 本地数据 = 可追溯周报</p></div></div><div class="card-body">
          <form id="review-form" class="form-grid">
            <div class="field"><label for="review-start">周报开始日期</label><input id="review-start" name="weekStart" type="date" value="${range.start}" required></div>
            <div class="field"><label for="review-end">周报结束日期</label><input id="review-end" name="weekEnd" type="date" value="${range.end}" required></div>
            <div class="field field-full"><label for="review-observations">人工观察</label><textarea id="review-observations" name="observations" maxlength="3000" placeholder="只写真实评论、咨询与内容观察。">${escapeHtml(review.observations || '')}</textarea></div>
            <div class="field field-full"><label for="review-risks">风险与阻塞</label><textarea id="review-risks" name="risks" maxlength="3000" placeholder="例如：无真实数据；版权素材无法确认；发布被推迟。">${escapeHtml(review.risks || '')}</textarea></div>
            <div class="field field-full"><label for="review-next">下周动作</label><textarea id="review-next" name="nextSteps" maxlength="3000" placeholder="最多写 3 个可执行动作。">${escapeHtml(review.nextSteps || '')}</textarea></div>
            <div class="field-full"><div class="inline-note"><strong>生成位置</strong><span>周报会写入 <code>analytics/weekly-review-YYYY-Www.md</code>，并更新本地看板数据。</span></div></div>
            <div class="field-full"><div class="form-actions"><button class="button button-primary" type="submit">生成周报文件</button></div></div>
          </form>
        </div></section>
        <section class="card"><div class="card-head"><div><h3>周报预览</h3><p>${escapeHtml(review.latestReportPath || '暂无周报文件')}</p></div><button class="button button-small" type="button" data-action="report-refresh">刷新</button></div><div class="card-body">
          <pre class="report-preview" id="report-preview">正在读取最新周报…</pre>
        </div></section>
      </div>
    </div>`;
  document.getElementById('review-form')?.addEventListener('submit', generateWeeklyReport);
  hydrateReportPreview();
}

async function hydrateReportPreview() {
  const host = document.getElementById('report-preview');
  if (!host) return;
  if (state.lastReportContent) {
    host.textContent = state.lastReportContent;
    return;
  }
  try {
    const result = await api('/api/reports/latest');
    state.lastReportContent = result.content;
    if (document.getElementById('report-preview')) document.getElementById('report-preview').textContent = result.content;
  } catch (error) {
    if (document.getElementById('report-preview')) document.getElementById('report-preview').textContent = `尚无最新周报：${error.message}`;
  }
}

async function generateWeeklyReport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api('/api/reports/weekly', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    state.lastReportContent = result.content;
    showToast(`周报已生成：${result.path}`);
    await refreshData({ render: false });
    renderReview();
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
  }
}

async function exportDashboard() {
  if (!state.data) return;
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `starmemory-dashboard-${localDateISO()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('看板数据已导出为 JSON');
}

function handleViewClick(event) {
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === 'jump-review') { state.notesFilter = 'review'; setView('notes'); return; }
    if (action === 'jump-all-notes') { state.notesFilter = 'all'; setView('notes'); return; }
    if (action === 'jump-calendar') { setView('calendar'); return; }
    if (action === 'report-refresh') { state.lastReportContent = null; hydrateReportPreview(); return; }
  }
  const productButton = event.target.closest('[data-product-edit]');
  if (productButton) { openProductModal(productButton.dataset.productEdit); return; }
  const deleteButton = event.target.closest('[data-analytics-delete]');
  if (deleteButton) {
    if (!window.confirm('确认删除这条误录数据？删除后该笔记会回退为「已批准」。')) return;
    api(`/api/analytics/${encodeURIComponent(deleteButton.dataset.analyticsDelete)}`, { method: 'DELETE' })
      .then(() => { showToast('数据记录已删除'); return refreshData(); })
      .catch(error => showToast(error.message, true));
    return;
  }
  const noteCard = event.target.closest('[data-note-id]');
  if (noteCard && !event.target.closest('a, button')) openNoteModal(noteCard.dataset.noteId);
}

function handleViewKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('[data-note-card]');
  if (!card) return;
  event.preventDefault();
  openNoteModal(card.dataset.noteId);
}

async function handleTaskChange(event) {
  const checkbox = event.target.closest('[data-task-id]');
  if (!checkbox) return;
  checkbox.disabled = true;
  try {
    await api(`/api/tasks/${encodeURIComponent(checkbox.dataset.taskId)}`, {
      method: 'PATCH', body: JSON.stringify({ status: checkbox.checked ? 'done' : 'todo' })
    });
    checkbox.closest('.task-row')?.classList.toggle('is-done', checkbox.checked);
    showToast('本周任务进度已保存');
    await refreshData({ render: false });
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    showToast(error.message, true);
  } finally {
    checkbox.disabled = false;
  }
}

async function bootstrap() {
  setConnection('loading');
  viewRoot.innerHTML = '<div class="loading-card"><span class="loading-orbit"></span><div><strong>正在连接本地看板</strong><p>127.0.0.1:4173 · dashboard/data/dashboard.json</p></div></div>';
  if (location.protocol === 'file:') {
    showError(new Error('浏览器直接打开 HTML 时无法读取本地 JSON。请启动本地 Node 服务后再访问。'));
    return;
  }
  try {
    await api('/api/health');
    setConnection('online');
    await refreshData();
  } catch (error) {
    showError(error);
  }
}

document.querySelectorAll('.nav-item').forEach(button => {
  button.addEventListener('click', () => setView(button.dataset.view));
});
document.getElementById('export-button').addEventListener('click', exportDashboard);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.querySelector('[data-modal-close]').addEventListener('click', closeModal);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !modalEl.hidden) closeModal();
});
viewRoot.addEventListener('click', handleViewClick);
viewRoot.addEventListener('keydown', handleViewKeydown);
viewRoot.addEventListener('change', handleTaskChange);

bootstrap();




