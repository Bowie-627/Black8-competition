const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modalRoot');
const nav = document.querySelector('#nav');
let state = null;
let view = 'home';
let scheduleTab = 'group';
let adminTab = 'overview';
let activePin = sessionStorage.getItem('black8-pin') || '';
const PLAYER_COLORS = [
  ['#dceee4', '#286548', '#8fc2a6'], ['#e7e7ff', '#4e52a3', '#aaaee5'], ['#fde4e8', '#a34d62', '#e9a4b2'], ['#fff1d8', '#9a6820', '#ebc47c'],
  ['#e3f1fb', '#397197', '#9bc8e5'], ['#f2e4fa', '#80519d', '#caa9de'], ['#ddf2f0', '#277976', '#84c6c1'], ['#ffe7df', '#a65339', '#eab09e']
];

const $ = (s, el = document) => el.querySelector(s);
const esc = (v = '') => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const name = (id) => state?.players.find((p) => p.id === id)?.id || '待定';
const player = (id) => state?.players.find((p) => p.id === id);
const playerColor = (id) => PLAYER_COLORS[Math.max(0, state?.players.findIndex((p) => p.id === id) || 0) % PLAYER_COLORS.length];
const playerStyle = (id) => { const [bg, ink, border] = playerColor(id); return `--player-bg:${bg};--player-ink:${ink};--player-border:${border};`; };
const avatar = (id, large = false) => { const p = player(id); const style = playerStyle(id); return p?.avatar ? `<img class="avatar player-accent ${large ? 'large' : ''}" style="${style}" src="${p.avatar}" alt="${esc(p.id)}">` : `<span class="avatar player-accent ${large ? 'large' : ''}" style="${style}">${esc((p?.id || '?').slice(0, 1).toUpperCase())}</span>`; };
const stageLabel = (stage) => ({ registration: '报名中', groups: '小组赛中', knockout: '淘汰赛中', finished: '赛事已结束' }[stage] || '筹备中');
const frameWins = (match, id) => match.frames.filter((f) => f.winnerId === id).length;
const fmtEventDate = (value) => { if (!value) return '待定'; const [year, month, day] = value.split('-'); return year && month && day ? `${year}年${Number(month)}月${Number(day)}日` : value; };
const matchSlotKey = (match) => match.roundKey || (match.phase === 'group' ? 'group-1' : match.round?.includes('半决赛') ? 'semifinal' : 'final');
const slotLabel = (match) => { const slot = state.config.scheduleSlots?.[matchSlotKey(match)]; if (!slot?.date) return '时间待定'; return `${fmtEventDate(slot.date)} ${slot.start || '--:--'}–${slot.end || '--:--'}`; };
const toast = (message, isError = false) => { const node = $('#toast'); node.textContent = message; node.style.background = isError ? '#ffddd7' : '#d5f9e2'; node.style.color = isError ? '#642118' : '#0a2a18'; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2600); };

async function loadState(silent = false) {
  try { const res = await fetch('/api/state'); state = await res.json(); $('#brandTitle').textContent = state.config.title; render(); if (!silent) toast('数据已更新'); }
  catch { if (!silent) toast('无法连接赛事服务器', true); }
}
async function api(url, payload, pin = false) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(pin ? { 'X-Admin-Pin': activePin } : {}) }, body: JSON.stringify(payload) });
  const data = await res.json(); if (!res.ok) throw Error(data.error || '操作失败'); return data;
}
async function action(action, payload = {}) { const data = await api('/api/admin/action', { action, payload }, true); state = data; render(); toast('已保存'); }
function setView(next) { view = next; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function shell(inner) { return inner; }
function render() {
  if (!state) { app.innerHTML = '<div class="empty">正在连接赛事服务器…</div>'; return; }
  const pages = { home: renderHome, schedule: renderSchedule, standings: renderStandings, bracket: renderBracketPage, stats: renderStats, rules: renderRules, admin: renderAdmin };
  app.innerHTML = shell((pages[view] || renderHome)());
  [...nav.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  [...document.querySelectorAll('#desktopGuide button')].forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}
function renderHome() {
  const champion = state.config.championId;
  return `<section class="hero"><div><h1>${esc(state.config.title)}</h1></div><aside class="status-card"><div class="stage-label">赛事阶段</div><div class="stage">${stageLabel(state.config.stage)}</div><div class="meta"><div><span>地点</span>${esc(state.config.location)}</div><div><span>日期</span>${esc(fmtEventDate(state.config.eventDate))}</div><div><span>报名</span><b class="mini-count">${state.players.length}/8</b> 人</div></div></aside></section>
  ${champion ? `<section class="section"><div class="card champion"><div class="trophy">🏆</div><h2>${esc(name(champion))}</h2>${avatar(champion, true)}</div></section>` : ''}
  <section class="section grid two"><div class="card">${renderSignup()}</div><div class="card"><div class="section-head"><h2>参赛名单</h2><span class="section-note">${state.players.length === 8 ? '名额已满' : `还剩 ${8 - state.players.length} 个名额`}</span></div>${state.players.length ? `<div class="people">${state.players.map((p) => `<button class="person-pill" data-player="${esc(p.id)}">${avatar(p.id)}${esc(p.id)}</button>`).join('')}</div>` : '<div class="empty">第一位球手，正在等你上场。</div>'}</div></section>
  <section class="section"><div class="section-head"><h2>赛程速览</h2><button class="btn ghost" data-view="schedule">全部赛程 →</button></div>${renderMatchList(state.matches.filter((m) => m.status === 'pending' || m.status === 'waiting').slice(0, 3))}</section>`;
}
function renderSignup() {
  if (!state.config.registrationsOpen || state.players.length >= 8) return `<div class="section-head"><h2>报名入口</h2></div><div class="empty">报名已关闭，${state.players.length >= 8 ? '8 位球手已集结完毕。' : '请关注赛事进程。'}</div>`;
  return `<div class="section-head"><h2>马上报名</h2><span class="section-note">限 8 人 · ID 可匿名</span></div><form id="signupForm"><div class="signup"><input class="input" name="id" maxlength="24" placeholder="输入你的比赛 ID" required><button class="btn primary">报名</button></div><label class="avatar-input">头像（可选，建议方形图片）<input name="avatar" type="file" accept="image/*"></label></form>`;
}
function renderMatchList(matches) {
  if (!matches.length) return '<div class="empty">暂无赛程。管理员分组后将自动显示在这里。</div>';
  return `<div class="match-list">${matches.map(renderMatch).join('')}</div>`;
}
function renderMatch(m) {
  const done = m.status === 'completed'; const score = done ? `${frameWins(m, m.p1)} : ${frameWins(m, m.p2)}` : '待定';
  const frames = m.frames.length ? `<div class="frame-detail">${m.frames.map((f, i) => `<span class="frame">第${i + 1}局 <strong>${esc(name(f.winnerId))} 8:${f.loserScore}</strong></span>`).join('')}</div>` : '';
  return `<article class="match"><div class="match-top"><span>${m.phase === 'group' ? `${m.group} 组 · ${m.round}` : `淘汰赛 · ${m.round}`} · ${m.bestOf} 局 ${m.targetWins} 胜</span><span>${slotLabel(m)}</span></div><div class="versus"><span class="player-name">${m.p1 ? `${avatar(m.p1)} ${esc(name(m.p1))}` : '待定'}</span><b class="score">${score}</b><span class="player-name">${m.p2 ? `${esc(name(m.p2))} ${avatar(m.p2)}` : '待定'}</span></div>${frames}</article>`;
}
function standings(group) {
  const ids = state.groups[group] || [];
  const rows = ids.map((id) => ({ id, wins: 0, losses: 0, pf: 0, pa: 0, played: 0 })); const map = Object.fromEntries(rows.map((r) => [r.id, r]));
  state.matches.filter((m) => m.phase === 'group' && m.group === group && m.status === 'completed').forEach((m) => { const a = map[m.p1], b = map[m.p2]; if (!a || !b) return; a.played++; b.played++; if (m.winnerId === m.p1) { a.wins++; b.losses++; } else { b.wins++; a.losses++; } m.frames.forEach((f) => { const loser = f.winnerId === m.p1 ? m.p2 : m.p1; map[f.winnerId].pf += 8; map[f.winnerId].pa += f.loserScore; map[loser].pf += f.loserScore; map[loser].pa += 8; }); });
  return rows.map((r) => ({ ...r, net: r.pf - r.pa })).sort((a, b) => b.wins - a.wins || b.net - a.net || a.id.localeCompare(b.id));
}
function standingTable(group) { const rows = standings(group); return `<div class="card table-wrap"><div class="section-head"><h2>${group} 组积分榜</h2><span class="section-note">胜场 → 净胜分</span></div>${rows.length ? `<table class="standing"><thead><tr><th>#</th><th>球手</th><th>胜</th><th>负</th><th>净胜分</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="rank">${i + 1}</td><td><button class="person-pill" data-player="${esc(r.id)}">${avatar(r.id)}${esc(r.id)}</button></td><td>${r.wins}</td><td>${r.losses}</td><td>${r.net > 0 ? '+' : ''}${r.net}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">尚未完成随机分组。</div>'}</div>`; }
function renderSchedule() { const group = state.matches.filter((m) => m.phase === 'group').sort((a, b) => matchSlotKey(a).localeCompare(matchSlotKey(b)) || a.group.localeCompare(b.group)); const knock = state.matches.filter((m) => m.phase === 'knockout'); const list = scheduleTab === 'group' ? group : knock; return `<section class="section"><div class="section-head"><div><h1>赛程与比分</h1></div></div><div class="tabs"><button class="${scheduleTab === 'group' ? 'active' : ''}" data-schedule="group">小组赛 (${group.length})</button><button class="${scheduleTab === 'knockout' ? 'active' : ''}" data-schedule="knockout">淘汰赛 (${knock.length})</button></div>${renderMatchList(list)}</section>${scheduleTab === 'knockout' ? renderBracket() : ''}`; }
function renderBracketPage() { return `<section class="section"><h1>淘汰赛对阵图</h1>${renderBracket()}</section>`; }
function renderStandings() { return `<section class="section"><h1>小组积分榜</h1><div class="grid two">${standingTable('A')}${standingTable('B')}</div></section>`; }
function playerStats(id) { let mw = 0, ml = 0, fw = 0, fl = 0, pf = 0, pa = 0, maxDiff = 0; const history = [];
  state.matches.filter((m) => (m.p1 === id || m.p2 === id) && m.status === 'completed').forEach((m) => { if (m.winnerId === id) mw++; else ml++; m.frames.forEach((f) => { if (f.winnerId === id) { fw++; pf += 8; pa += f.loserScore; maxDiff = Math.max(maxDiff, 8 - f.loserScore); } else { fl++; pf += f.loserScore; pa += 8; } }); history.push(m); }); return { mw, ml, fw, fl, pf, pa, net: pf - pa, rate: mw + ml ? Math.round(mw / (mw + ml) * 100) : 0, maxDiff, history }; }
function renderStats() { const rows = state.players.map((p) => ({ id: p.id, ...playerStats(p.id) })).sort((a, b) => b.mw - a.mw || b.rate - a.rate || b.net - a.net); return `<section class="section"><h1>统计榜</h1><div class="grid two">${rows.length ? rows.map((r, i) => `<button class="card stat-card player-card" data-player="${esc(r.id)}" style="${playerStyle(r.id)}text-align:left;color:inherit;cursor:pointer"><div class="section-head"><span class="rank">#${i + 1}</span><span class="person-pill">${avatar(r.id)}${esc(r.id)}</span></div><div class="stats-grid"><div class="stat"><span>总胜场</span><b>${r.mw}</b></div><div class="stat"><span>胜率</span><b>${r.rate}%</b></div><div class="stat"><span>净胜分</span><b>${r.net > 0 ? '+' : ''}${r.net}</b></div><div class="stat"><span>单局最大分差</span><b>${r.maxDiff}</b></div></div></button>`).join('') : '<div class="empty">暂无统计数据。</div>'}</div></section>`; }
function renderBracket() { const knock = state.matches.filter((m) => m.phase === 'knockout'); if (!knock.length) return '<section class="section"><div class="empty">小组赛结束后生成对阵图。</div></section>'; const semis = knock.filter((m) => m.round.includes('半决赛')); const final = knock.find((m) => m.round === '决赛'); return `<section class="section"><div class="card bracket"><div class="bracket-col"><div class="round-title">半决赛</div>${semis.map(renderMatch).join('')}</div><div class="bracket-col"><div class="round-title">决赛</div>${renderMatch(final)}${state.config.championId ? `<div class="champion card"><div class="trophy">🏆</div><b>${esc(name(state.config.championId))}</b></div>` : ''}</div></div></section>`; }
function renderRules() { const rules = String(state.config.rulesText || '').split(/\n+/).map((line) => line.trim()).filter(Boolean); return `<section class="section"><h1>比赛规则</h1><div class="card">${rules.map((rule, index) => `<div class="rule"><div class="rule-num">${String(index + 1).padStart(2, '0')}</div><div><p>${esc(rule)}</p></div></div>`).join('')}</div></section>`; }

function renderAdmin() {
  if (!activePin) return `<section class="section"><div class="empty">管理后台需要验证 PIN。</div></section>`;
  const labels = { overview: '赛事控制', players: '报名名单', schedule: '赛程时间', results: '比分录入', rules: '比赛规则', settings: '赛事设置', logs: '日志与重置' };
  const page = { overview: adminOverview, players: adminPlayers, schedule: adminSchedule, results: adminResults, rules: adminRules, settings: adminSettings, logs: adminLogs }[adminTab]();
  return `<section class="admin-shell"><aside class="admin-menu">${Object.entries(labels).map(([k, v]) => `<button class="${adminTab === k ? 'active' : ''}" data-admin-tab="${k}">${v}</button>`).join('')}<button data-admin-logout>退出管理</button></aside><div class="admin-panel">${page}</div></section>`;
}
function adminOverview() { const groupGenerated = state.matches.some((m) => m.phase === 'group'); const canKnock = state.matches.filter((m) => m.phase === 'group').length === 12 && state.matches.filter((m) => m.phase === 'group').every((m) => m.status === 'completed'); const knockGenerated = state.matches.some((m) => m.phase === 'knockout'); return `<h1>赛事控制</h1><p>按赛事进程执行。系统会保留每次管理操作的日志。</p><div class="grid two"><div class="card"><h2>1. 随机分组</h2><p class="section-note">目前 ${state.players.length}/8 人。随机后会关闭报名。</p><div class="admin-actions"><button class="btn primary" data-action="randomize" ${state.players.length !== 8 || groupGenerated ? 'disabled' : ''}>随机分为 A/B 两组</button></div>${state.groups.A.length ? `<div class="people">${state.groups.A.map((id) => `<span class="person-pill">A · ${esc(id)}</span>`).join('')}${state.groups.B.map((id) => `<span class="person-pill">B · ${esc(id)}</span>`).join('')}</div>` : ''}</div><div class="card"><h2>2. 生成小组赛程</h2><p class="section-note">每组 6 场，共 12 场，3 局 2 胜。</p><button class="btn primary" data-action="generateGroups" ${!state.groups.A.length || groupGenerated ? 'disabled' : ''}>生成循环赛程</button></div><div class="card"><h2>3. 确认晋级并生成淘汰赛</h2><p class="section-note">A1 vs B2、B1 vs A2；半决赛与决赛为 5 局 3 胜。</p><button class="btn primary" data-action="generateKnockout" ${!canKnock || knockGenerated ? 'disabled' : ''}>生成淘汰赛对阵</button></div><div class="card"><h2>当前阶段</h2><p class="stage">${stageLabel(state.config.stage)}</p><p class="section-note">完成决赛后，系统会自动加冕冠军。</p></div></div>`; }
function adminPlayers() { return `<h1>报名名单</h1><p>可在分组前增删修改；比赛开始后删除选手需要先重置赛程。</p><div class="card"><form id="adminPlayerForm"><div class="grid two"><div class="field"><label>比赛 ID</label><input class="input" name="id" maxlength="24" required placeholder="添加或更新 ID"></div><div class="field"><label>头像（可选）</label><input name="avatar" type="file" accept="image/*"></div></div><button class="btn primary">保存选手</button></form></div><div class="card" style="margin-top:15px">${state.players.length ? state.players.map((p) => `<div class="admin-row"><span class="person-pill">${avatar(p.id)}${esc(p.id)}</span><div class="admin-actions"><button class="btn ghost" data-edit-player="${esc(p.id)}">编辑</button><button class="btn warn" data-delete-player="${esc(p.id)}">删除</button></div></div>`).join('') : '<div class="empty">尚无报名。</div>'}</div>`; }
function adminResults() { const editable = state.matches.filter((m) => m.status === 'pending'); const completed = state.matches.filter((m) => m.status === 'completed'); return `<h1>逐局比分录入</h1><p>点选本局胜方，再填写对手已进球数（0–7）。胜方自动记为 8 分。</p><div class="grid two"><div class="card"><h2>待录入</h2>${editable.length ? `<div class="match-list">${editable.map((m) => `${renderMatch(m)}<div class="admin-actions" style="margin-top:8px"><button class="btn primary" data-record="${m.id}">录入下一局</button></div>`).join('')}</div>` : '<div class="empty">当前没有可录入的比赛。</div>'}</div><div class="card"><h2>已完成</h2>${completed.length ? completed.map((m) => `<div class="admin-row"><span>${esc(m.phase === 'group' ? `${m.group}组` : m.round)} · ${esc(name(m.p1))} ${frameWins(m,m.p1)}:${frameWins(m,m.p2)} ${esc(name(m.p2))}</span><button class="btn ghost" data-undo="${m.id}">撤销本场</button></div>`).join('') : '<div class="empty">尚无已结束比赛。</div>'}</div></div>`; }
function adminSettings() { return `<h1>赛事设置</h1><p>赛事日期显示在公开首页。</p><form id="settingsForm" class="card"><div class="field"><label>赛事名称</label><input class="input" name="title" value="${esc(state.config.title)}"></div><div class="grid two"><div class="field"><label>地点</label><input class="input" name="location" value="${esc(state.config.location)}"></div><div class="field"><label>赛事日期</label><input class="input" type="date" name="eventDate" value="${esc(state.config.eventDate || '')}"></div></div><div class="field"><label>新管理 PIN（留空不改）</label><input class="input" name="newPin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="4 位数字"></div><button class="btn primary">保存设置</button></form>`; }
function adminSchedule() { const items = [['group-1', '小组赛 · 第 1 轮'], ['group-2', '小组赛 · 第 2 轮'], ['group-3', '小组赛 · 第 3 轮'], ['semifinal', '淘汰赛 · 半决赛'], ['final', '淘汰赛 · 决赛']]; return `<h1>赛程时间</h1><p>一次设置会应用到该轮次或阶段的所有比赛。</p><form id="scheduleSlotsForm" class="grid">${items.map(([key, label]) => { const slot = state.config.scheduleSlots?.[key] || {}; return `<div class="card"><h2>${label}</h2><div class="grid three"><div class="field"><label>日期</label><input class="input" type="date" name="${key}_date" value="${esc(slot.date || '')}"></div><div class="field"><label>开始时间</label><input class="input" type="time" name="${key}_start" value="${esc(slot.start || '')}"></div><div class="field"><label>结束时间</label><input class="input" type="time" name="${key}_end" value="${esc(slot.end || '')}"></div></div></div>`; }).join('')}<button class="btn primary">批量保存赛程时间</button></form>`; }
function adminRules() { return `<h1>比赛规则</h1><p>每行会在公开规则页中显示为一条规则。</p><form id="rulesForm" class="card"><div class="field"><label>规则内容</label><textarea class="input" name="rulesText" rows="10" maxlength="4000" required>${esc(state.config.rulesText || '')}</textarea></div><button class="btn primary">保存比赛规则</button></form>`; }
function adminLogs() { return `<h1>日志与重置</h1><p>重置用于纠错。建议在重置前先记录当前比分。</p><div class="card"><div class="admin-row"><div><b>重置赛程</b><p class="section-note">保留报名名单，清除分组、赛程和比分。</p></div><button class="btn warn" data-reset="resetCompetition">重置赛程</button></div><div class="admin-row"><div><b>清空赛事</b><p class="section-note">清除报名名单、赛程和比分，保留赛事资料与 PIN。</p></div><button class="btn warn" data-reset="resetAll">清空全部数据</button></div></div><div class="card" style="margin-top:15px"><h2>操作日志</h2>${state.logs.length ? state.logs.map((l) => `<div class="log"><time>${new Date(l.at).toLocaleString('zh-CN')}</time><b>${esc(l.action)}</b> · ${esc(l.detail)}</div>`).join('') : '<div class="empty">暂无操作记录。</div>'}</div>`; }

function modal(html) { modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal" onclick="event.stopPropagation()">${html}</section></div>`; }
function closeModal() { modalRoot.innerHTML = ''; }
function openLogin() { modal(`<h2>管理入口</h2><p>请输入 4 位数字 PIN 进入赛事控制台。</p><form id="loginForm"><div class="field"><label>管理 PIN</label><input class="input" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autofocus required></div><div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button class="btn primary">进入管理</button></div></form>`); }
function openScore(matchId) { const m = state.matches.find((x) => x.id === matchId); if (!m) return; modal(`<h2>录入第 ${m.frames.length + 1} 局</h2><p>${esc(name(m.p1))} vs ${esc(name(m.p2))} · 胜方自动记 8 分。</p><form id="scoreForm" data-match="${m.id}"><div class="score-entry"><button type="button" class="winner-pick" data-winner="${esc(m.p1)}">${avatar(m.p1)} ${esc(name(m.p1))}<small>选择为本局胜方</small></button><button type="button" class="winner-pick" data-winner="${esc(m.p2)}">${avatar(m.p2)} ${esc(name(m.p2))}<small>选择为本局胜方</small></button></div><div class="field"><label>负方已进球数（0–7）</label><select name="loserScore">${[0,1,2,3,4,5,6,7].map((n) => `<option value="${n}">${n} 分</option>`).join('')}</select></div><input type="hidden" name="winnerId"><div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button id="scoreSubmit" class="btn primary" disabled>确认记录</button></div></form>`); const form = $('#scoreForm', modalRoot); form.querySelectorAll('[data-winner]').forEach((button) => button.addEventListener('click', () => { form.querySelectorAll('[data-winner]').forEach((item) => item.classList.toggle('selected', item === button)); form.elements.winnerId.value = button.dataset.winner; $('#scoreSubmit', form).disabled = false; })); }
function openPlayer(id) { const p = player(id); const s = playerStats(id); modal(`<div style="display:flex;gap:12px;align-items:center"><span>${avatar(id,true)}</span><div><h2 style="margin:0">${esc(p.id)}</h2><p style="margin:4px 0 0">个人战绩卡</p></div></div><div class="stats-grid" style="margin-top:17px"><div class="stat"><span>总胜场</span><b>${s.mw}</b></div><div class="stat"><span>胜率</span><b>${s.rate}%</b></div><div class="stat"><span>净胜分</span><b>${s.net > 0 ? '+' : ''}${s.net}</b></div><div class="stat"><span>最大分差</span><b>${s.maxDiff}</b></div></div><h3>历史对阵</h3>${s.history.length ? `<div class="match-list">${s.history.map(renderMatch).join('')}</div>` : '<div class="empty">尚未完成比赛。</div>'}<div class="modal-actions"><button class="btn primary" data-close>关闭</button></div>`); }

document.addEventListener('click', async (e) => {
  const target = e.target.closest('button,[data-close-modal]'); if (!target) return;
  if (target.dataset.closeModal !== undefined || target.dataset.close !== undefined) return closeModal();
  if (target.dataset.view) return setView(target.dataset.view);
  if (target.id === 'adminEntry') return activePin ? setView('admin') : openLogin();
  if (target.dataset.schedule) { scheduleTab = target.dataset.schedule; return render(); }
  if (target.dataset.adminTab) { adminTab = target.dataset.adminTab; return render(); }
  if (target.dataset.adminLogout !== undefined) { sessionStorage.removeItem('black8-pin'); activePin = ''; view = 'home'; toast('已退出管理'); return render(); }
  if (target.dataset.player) return openPlayer(target.dataset.player);
  if (target.dataset.editPlayer) { const id = target.dataset.editPlayer; const form = $('#adminPlayerForm'); form.id.value = id; form.dataset.originalId = id; form.querySelector('button').textContent = `更新 ${id}`; form.scrollIntoView({ behavior: 'smooth' }); return; }
  if (target.dataset.deletePlayer) { if (confirm(`确认删除 ${target.dataset.deletePlayer}？`)) { try { await action('deletePlayer', { id: target.dataset.deletePlayer }); } catch (err) { toast(err.message, true); } } return; }
  if (target.dataset.action) { const labels = { randomize: '随机分组', generateGroups: '生成小组赛程', generateKnockout: '生成淘汰赛对阵' }; if (!confirm(`确认${labels[target.dataset.action]}？`)) return; try { await action(target.dataset.action); } catch (err) { toast(err.message, true); } return; }
  if (target.dataset.record) return openScore(target.dataset.record);
  if (target.dataset.undo) { if (confirm('确认撤销该场全部比分？')) try { await action('undoMatch', { matchId: target.dataset.undo }); } catch (err) { toast(err.message, true); } return; }
  if (target.dataset.reset) { if (confirm(target.dataset.reset === 'resetAll' ? '确认清空所有名单与赛事数据？' : '确认重置赛程？')) try { await action(target.dataset.reset); } catch (err) { toast(err.message, true); } }
});
document.addEventListener('submit', async (e) => { e.preventDefault(); const form = e.target; try {
  if (form.id === 'signupForm') { const file = form.avatar.files[0]; const avatarData = file ? await fileToData(file) : ''; state = await api('/api/register', { id: form.id.value, avatar: avatarData }); form.reset(); render(); toast('报名成功，欢迎上场！'); }
  if (form.id === 'loginForm') { const pin = form.pin.value; const result = await api('/api/admin/login', { pin }); if (!result.ok) throw Error('PIN 不正确'); activePin = pin; sessionStorage.setItem('black8-pin', pin); closeModal(); view = 'admin'; render(); toast('已进入管理后台'); }
  if (form.id === 'adminPlayerForm') { const file = form.avatar.files[0]; await action('playerUpsert', { id: form.id.value, originalId: form.dataset.originalId || '', avatar: file ? await fileToData(file) : '' }); form.reset(); delete form.dataset.originalId; }
  if (form.id === 'settingsForm') { await action('settings', Object.fromEntries(new FormData(form))); if (form.newPin.value) { activePin = form.newPin.value; sessionStorage.setItem('black8-pin', activePin); } }
  if (form.id === 'scheduleSlotsForm') { const data = new FormData(form); const keys = ['group-1', 'group-2', 'group-3', 'semifinal', 'final']; const slots = Object.fromEntries(keys.map((key) => [key, { date: data.get(`${key}_date`), start: data.get(`${key}_start`), end: data.get(`${key}_end`) }])); await action('scheduleSlots', { slots }); }
  if (form.id === 'rulesForm') { await action('rules', { rulesText: form.elements.rulesText.value }); }
  if (form.id === 'scoreForm') { if (!form.elements.winnerId.value) throw Error('请先选择本局胜方'); await action('recordFrame', { matchId: form.dataset.match, winnerId: form.elements.winnerId.value, loserScore: form.elements.loserScore.value }); closeModal(); }
} catch (err) { toast(err.message, true); } });
function fileToData(file) { return new Promise((resolve, reject) => { if (file.size > 1_400_000) return reject(Error('头像请小于 1.4MB')); const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
setInterval(() => { if (!document.hidden && !modalRoot.innerHTML) loadState(true); }, 10000);
loadState(true);
