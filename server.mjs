import http from 'node:http';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');
const dataDir = process.env.DATA_DIR || join(root, 'data');
const dataFile = join(dataDir, 'tournament.json');
const seedFile = join(root, 'data', 'tournament.json');
const PORT = Number(process.env.PORT || 3000);
const pinHash = (pin) => createHash('sha256').update(String(pin)).digest('hex');
const DEFAULT_RULES = '赛制：8 位参赛者随机分为 A、B 两组，各 4 人循环比赛；每组前两名交叉晋级半决赛。\n小组赛：每场 3 局 2 胜。\n淘汰赛：半决赛与决赛均为 5 局 3 胜。\n单局比分：胜方记 8 分；负方按当局已进球数记 0–7 分。\n积分排名：优先比较比赛胜场，其次比较累计净胜分。';

const freshState = () => ({
  config: {
    title: '公司中式黑八挑战赛', location: '地点待定', eventDate: '',
    scheduleSlots: {}, rulesText: DEFAULT_RULES,
    stage: 'registration', registrationsOpen: true, championId: null, adminPinHash: pinHash('1234')
  },
  players: [], groups: { A: [], B: [] }, matches: [], logs: []
});

let state;
async function load() {
  try { state = JSON.parse(await readFile(dataFile, 'utf8')); state.config.eventDate ??= ''; state.config.scheduleSlots ??= {}; state.config.rulesText ??= DEFAULT_RULES; migrateLegacyRounds(); await save(); }
  catch {
    try { state = JSON.parse(await readFile(seedFile, 'utf8')); await save(); }
    catch { state = freshState(); await save(); }
  }
}
async function save() {
  await mkdir(dirname(dataFile), { recursive: true });
  const temp = `${dataFile}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
  await rename(temp, dataFile);
}
function publicState() {
  const copy = structuredClone(state);
  delete copy.config.adminPinHash;
  return copy;
}
function addLog(action, detail) {
  state.logs.unshift({ id: randomUUID(), at: new Date().toISOString(), action, detail });
  state.logs = state.logs.slice(0, 120);
}
function player(id) { return state.players.find((p) => p.id === id); }
function groupOf(id) { return state.groups.A.includes(id) ? 'A' : state.groups.B.includes(id) ? 'B' : null; }
function migrateLegacyRounds() {
  const rounds = [[[0, 3], [1, 2]], [[0, 2], [3, 1]], [[0, 1], [2, 3]]];
  ['A', 'B'].forEach((group) => {
    const members = state.groups?.[group] || [];
    const lookup = new Map();
    rounds.forEach((pairs, roundIndex) => pairs.forEach(([a, b]) => lookup.set([members[a], members[b]].sort().join('|'), roundIndex + 1)));
    state.matches?.filter((match) => match.phase === 'group' && match.group === group && !match.roundKey).forEach((match) => {
      const round = lookup.get([match.p1, match.p2].sort().join('|')) || 1;
      match.round = `第 ${round} 轮`; match.roundKey = `group-${round}`;
    });
  });
}
function settled(match) { return match.status === 'completed'; }
function matchWins(match, id) { return match.frames.filter((f) => f.winnerId === id).length; }
function standings(group) {
  const rows = state.groups[group].map((id) => ({ id, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, matches: 0 }));
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  state.matches.filter((m) => m.phase === 'group' && m.group === group && settled(m)).forEach((m) => {
    const a = byId[m.p1], b = byId[m.p2]; if (!a || !b) return;
    a.matches++; b.matches++;
    if (m.winnerId === m.p1) { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
    m.frames.forEach((f) => {
      const other = f.winnerId === m.p1 ? m.p2 : m.p1;
      byId[f.winnerId].pointsFor += f.winnerScore; byId[f.winnerId].pointsAgainst += f.loserScore;
      byId[other].pointsFor += f.loserScore; byId[other].pointsAgainst += f.winnerScore;
    });
  });
  return rows.map((r) => ({ ...r, net: r.pointsFor - r.pointsAgainst }))
    .sort((a, b) => b.wins - a.wins || b.net - a.net || a.id.localeCompare(b.id));
}
function allGroupsComplete() {
  const games = state.matches.filter((m) => m.phase === 'group');
  return games.length === 12 && games.every(settled);
}
function createGroupMatches() {
  if (state.matches.some((m) => m.phase === 'group')) throw Error('小组赛程已生成');
  const rounds = [[[0, 3], [1, 2]], [[0, 2], [3, 1]], [[0, 1], [2, 3]]];
  ['A', 'B'].forEach((group) => {
    const members = state.groups[group];
    if (members.length !== 4) throw Error('每组必须正好 4 人');
    rounds.forEach((pairs, index) => pairs.forEach(([a, b]) => state.matches.push({ id: randomUUID(), phase: 'group', group, round: `第 ${index + 1} 轮`, roundKey: `group-${index + 1}`, p1: members[a], p2: members[b], bestOf: 3, targetWins: 2, frames: [], status: 'pending', winnerId: null })));
  });
}
function createKnockout() {
  if (!allGroupsComplete()) throw Error('请先完成全部小组赛');
  if (state.matches.some((m) => m.phase === 'knockout')) throw Error('淘汰赛对阵已生成');
  const [a1, a2] = standings('A'); const [b1, b2] = standings('B');
  const semi1 = { id: randomUUID(), phase: 'knockout', round: '半决赛 1', roundKey: 'semifinal', p1: a1.id, p2: b2.id, bestOf: 5, targetWins: 3, frames: [], status: 'pending', winnerId: null };
  const semi2 = { id: randomUUID(), phase: 'knockout', round: '半决赛 2', roundKey: 'semifinal', p1: b1.id, p2: a2.id, bestOf: 5, targetWins: 3, frames: [], status: 'pending', winnerId: null };
  const final = { id: randomUUID(), phase: 'knockout', round: '决赛', roundKey: 'final', p1: null, p2: null, source: [semi1.id, semi2.id], bestOf: 5, targetWins: 3, frames: [], status: 'waiting', winnerId: null };
  state.matches.push(semi1, semi2, final);
}
function refreshFinal() {
  const final = state.matches.find((m) => m.phase === 'knockout' && m.round === '决赛');
  if (!final || !final.source) return;
  const semis = final.source.map((id) => state.matches.find((m) => m.id === id));
  if (semis.every((m) => m?.winnerId)) {
    final.p1 = semis[0].winnerId; final.p2 = semis[1].winnerId; final.status = final.winnerId ? 'completed' : 'pending';
  } else {
    final.p1 = null; final.p2 = null; final.frames = []; final.winnerId = null; final.status = 'waiting';
    state.config.championId = null; if (state.config.stage === 'finished') state.config.stage = 'knockout';
  }
}
function recordFrame({ matchId, winnerId, loserScore }) {
  const match = state.matches.find((m) => m.id === matchId);
  const score = Number(loserScore);
  if (!match || match.status !== 'pending') throw Error('该场比赛暂不可录分');
  if (![match.p1, match.p2].includes(winnerId) || !Number.isInteger(score) || score < 0 || score > 7) throw Error('比分数据无效');
  const loserId = winnerId === match.p1 ? match.p2 : match.p1;
  match.frames.push({ id: randomUUID(), winnerId, loserId, winnerScore: 8, loserScore: score });
  if (matchWins(match, winnerId) >= match.targetWins) { match.status = 'completed'; match.winnerId = winnerId; }
  refreshFinal();
  if (match.phase === 'knockout' && match.round === '决赛' && match.winnerId) { state.config.stage = 'finished'; state.config.championId = match.winnerId; }
}
function authorized(req) { return req.headers['x-admin-pin'] && pinHash(req.headers['x-admin-pin']) === state.config.adminPinHash; }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 2_500_000) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Error('请求格式错误')); } }); }); }
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

async function adminAction(action, payload) {
  if (action === 'settings') {
    ['title', 'location', 'eventDate'].forEach((k) => { if (typeof payload[k] === 'string') state.config[k] = payload[k].trim().slice(0, 100); });
    if (payload.newPin) { if (!/^\d{4}$/.test(payload.newPin)) throw Error('PIN 必须为 4 位数字'); state.config.adminPinHash = pinHash(payload.newPin); }
    addLog('更新赛事资料', '修改了赛事基础信息');
  } else if (action === 'scheduleSlots') {
    const allowed = ['group-1', 'group-2', 'group-3', 'semifinal', 'final'];
    state.config.scheduleSlots = Object.fromEntries(allowed.map((key) => {
      const item = payload.slots?.[key] || {};
      return [key, { date: String(item.date || '').slice(0, 10), start: String(item.start || '').slice(0, 5), end: String(item.end || '').slice(0, 5) }];
    }));
    addLog('批量设置赛程时间', '已更新各轮次与淘汰赛时间');
  } else if (action === 'rules') {
    if (typeof payload.rulesText !== 'string' || !payload.rulesText.trim()) throw Error('比赛规则不能为空');
    state.config.rulesText = payload.rulesText.trim().slice(0, 4000);
    addLog('更新比赛规则', '已修改公开规则说明');
  } else if (action === 'playerUpsert') {
    const id = String(payload.id || '').trim().slice(0, 24); if (!id) throw Error('请输入选手 ID');
    const existing = state.players.find((p) => p.id.toLowerCase() === id.toLowerCase());
    if (payload.originalId && payload.originalId !== id) {
      const original = player(payload.originalId); if (!original || existing) throw Error('ID 不可用'); original.id = id;
      ['A', 'B'].forEach((g) => { state.groups[g] = state.groups[g].map((x) => x === payload.originalId ? id : x); });
      state.matches.forEach((m) => { if (m.p1 === payload.originalId) m.p1 = id; if (m.p2 === payload.originalId) m.p2 = id; if (m.winnerId === payload.originalId) m.winnerId = id; m.frames.forEach((f) => { if (f.winnerId === payload.originalId) f.winnerId = id; if (f.loserId === payload.originalId) f.loserId = id; }); });
    } else if (existing) { existing.avatar = payload.avatar || existing.avatar; } else { if (state.players.length >= 8) throw Error('报名人数已满'); state.players.push({ id, avatar: payload.avatar || '', joinedAt: new Date().toISOString() }); }
    addLog('管理选手', `更新选手：${id}`);
  } else if (action === 'deletePlayer') {
    if (state.matches.length) throw Error('已有赛程，不能删除选手；请先重置赛事');
    state.players = state.players.filter((p) => p.id !== payload.id); addLog('删除选手', payload.id);
  } else if (action === 'randomize') {
    if (state.players.length !== 8) throw Error('必须正好 8 位选手才能分组'); if (state.matches.length) throw Error('已有赛程，请先重置赛事');
    const ids = state.players.map((p) => p.id).sort(() => Math.random() - .5); state.groups = { A: ids.slice(0, 4), B: ids.slice(4) }; state.config.stage = 'groups'; state.config.registrationsOpen = false; addLog('随机分组', '已生成 A/B 两组');
  } else if (action === 'generateGroups') { createGroupMatches(); state.config.stage = 'groups'; addLog('生成小组赛程', '共 12 场');
  } else if (action === 'generateKnockout') { createKnockout(); state.config.stage = 'knockout'; addLog('生成淘汰赛', '半决赛与决赛已创建');
  } else if (action === 'recordFrame') { recordFrame(payload); addLog('录入单局比分', `${payload.matchId.slice(0, 8)}…`);
  } else if (action === 'undoMatch') { const m = state.matches.find((x) => x.id === payload.matchId); if (!m) throw Error('找不到比赛'); m.frames = []; m.status = m.p1 && m.p2 ? 'pending' : 'waiting'; m.winnerId = null; state.config.championId = null; if (state.config.stage === 'finished') state.config.stage = 'knockout'; refreshFinal(); addLog('撤销比分', `${m.round}`);
  } else if (action === 'resetCompetition') { state.groups = { A: [], B: [] }; state.matches = []; state.config.stage = 'registration'; state.config.registrationsOpen = true; state.config.championId = null; addLog('重置赛程', '保留报名名单');
  } else if (action === 'resetAll') { const config = state.config; state = freshState(); state.config.title = config.title; state.config.location = config.location; state.config.eventTime = config.eventTime; state.config.adminPinHash = config.adminPinHash; addLog('清空赛事', '名单与赛程已清空');
  } else throw Error('未知操作');
  await save();
}

await load();
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState());
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const data = await body(req); const id = String(data.id || '').trim().slice(0, 24);
      if (!state.config.registrationsOpen || state.players.length >= 8) throw Error('报名已关闭或人数已满');
      if (!id) throw Error('请填写 ID'); if (state.players.some((p) => p.id.toLowerCase() === id.toLowerCase())) throw Error('该 ID 已被使用');
      state.players.push({ id, avatar: String(data.avatar || '').slice(0, 2_000_000), joinedAt: new Date().toISOString() }); addLog('报名', id); await save(); return json(res, 201, publicState());
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/login') { const data = await body(req); return json(res, pinHash(data.pin || '') === state.config.adminPinHash ? 200 : 401, { ok: pinHash(data.pin || '') === state.config.adminPinHash }); }
    if (req.method === 'POST' && url.pathname === '/api/admin/action') { if (!authorized(req)) return json(res, 401, { error: 'PIN 无效' }); const data = await body(req); await adminAction(data.action, data.payload || {}); return json(res, 200, publicState()); }
    if (req.method === 'GET') {
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const filename = normalize(join(publicDir, requested)); if (!filename.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
      try { const content = await readFile(filename); res.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream' }); return res.end(content); } catch { return json(res, 404, { error: 'Not found' }); }
    }
    json(res, 405, { error: 'Method not allowed' });
  } catch (error) { json(res, 400, { error: error.message || '操作失败' }); }
}).listen(PORT, '0.0.0.0', () => console.log(`黑八赛事站已启动：http://localhost:${PORT}`));
