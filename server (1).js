// Без зависимостей, нужен Node 18+. Запуск:
// BOT_TOKEN=... PUBLIC_URL=https://твой-сервер APP_URL=https://ник.github.io/репо ADMIN_ID=твой_id node server.js
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const T = process.env.BOT_TOKEN, PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL, APP_URL = process.env.APP_URL;
const ADMIN_ID = process.env.ADMIN_ID, ADMIN_NAME = 'yung_roxy';
const CFG = { MIN: 100, MAX: 1000, MULTS: [1.5, 2, 3, 5, 10], EDGE: 0.95 }; // шанс = EDGE / множитель
const SECRET = crypto.createHash('sha256').update('wh' + T).digest('hex').slice(0, 32);

let db = { u: {}, p: {} };
try { db = JSON.parse(fs.readFileSync('db.json')); } catch {}
const save = () => fs.writeFileSync('db.json', JSON.stringify(db));
const api = (m, b) => fetch(`https://api.telegram.org/bot${T}/${m}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b)
}).then(r => r.json());
const say = (id, text) => api('sendMessage', { chat_id: id, text }).catch(() => {});
const rid = () => crypto.randomBytes(4).toString('hex');
const user = (id, un) => {
  const u = db.u[id] || (db.u[id] = { id: String(id), un: '', t: [] });
  if (un) u.un = un;
  return u;
};
const st = u => ({ t: u.t, cfg: CFG });
const isAdmin = f => String(f.id) === ADMIN_ID || (f.username || '').toLowerCase() === ADMIN_NAME;

function auth(init) {
  const p = new URLSearchParams(init || ''), h = p.get('hash');
  p.delete('hash');
  const s = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => k + '=' + v).join('\n');
  const k = crypto.createHmac('sha256', 'WebAppData').update(T).digest();
  if (crypto.createHmac('sha256', k).update(s).digest('hex') !== h) return null;
  if (Date.now() / 1000 - p.get('auth_date') > 86400) return null;
  const f = JSON.parse(p.get('user'));
  return user(f.id, f.username || f.first_name);
}

const take = (u, n) => {
  let got = 0;
  for (const k of u.t) { const c = Math.min(k.v, n - got); k.v -= c; got += c; if (got >= n) break; }
  u.t = u.t.filter(k => k.v > 0);
  return got;
};
const find = a => /^\d+$/.test(a) ? user(a)
  : Object.values(db.u).find(x => x.un && '@' + x.un.toLowerCase() === a.toLowerCase());

async function admin(m) {
  const [c, a, n] = m.text.split(/\s+/), id = m.chat.id, v = parseInt(a === '/giveall' ? 0 : n || a);
  if (c === '/users') return say(id, `Игроков: ${Object.keys(db.u).length}\n` + Object.values(db.u).slice(-30)
    .map(u => `${u.id} @${u.un} — ${u.t.reduce((s, k) => s + k.v, 0)}☆`).join('\n'));
  if (c === '/giveall' || c === '/takeall') {
    const n2 = parseInt(a); if (!(n2 > 0)) return say(id, `Формат: ${c} <☆>`);
    for (const u of Object.values(db.u)) {
      if (c === '/giveall') u.t.push({ id: rid(), v: n2 }); else take(u, n2);
      say(u.id, c === '/giveall' ? `🎁 Тебе начислен билет на ${n2}☆` : `Списано ${n2}☆`);
    }
    save(); return say(id, 'Готово ✅');
  }
  if (c === '/give' || c === '/take') {
    const u = a && find(a), n2 = parseInt(n);
    if (!u || !(n2 > 0)) return say(id, `Формат: ${c} <id или @ник> <☆>`);
    if (c === '/give') { u.t.push({ id: rid(), v: n2 }); say(u.id, `🎁 Тебе начислен билет на ${n2}☆`); }
    else { const g = take(u, n2); say(id, `Забрано ${g}☆`); say(u.id, `Списано ${g}☆`); }
    save(); return say(id, 'Готово ✅');
  }
  say(id, '/give <id|@ник> <☆>\n/take <id|@ник> <☆>\n/giveall <☆>\n/takeall <☆>\n/users');
}

async function hook(up) {
  if (up.pre_checkout_query) return api('answerPreCheckoutQuery', { pre_checkout_query_id: up.pre_checkout_query.id, ok: true });
  const m = up.message; if (!m) return;
  const sp = m.successful_payment;
  if (sp) {
    const d = JSON.parse(sp.invoice_payload);
    if (db.p[sp.telegram_payment_charge_id] || sp.currency !== 'XTR' || sp.total_amount !== d.a) return;
    db.p[sp.telegram_payment_charge_id] = 1;
    user(d.u).t.push({ id: rid(), v: d.a }); save();
    return say(m.chat.id, `✅ Билет на ${d.a}☆ куплен`);
  }
  user(m.from.id, m.from.username || m.from.first_name);
  const t = m.text || '';
  if (t.startsWith('/start')) return api('sendMessage', { chat_id: m.chat.id, text: 'Покупай билеты и апгрейдь их 🎟',
    reply_markup: { inline_keyboard: [[{ text: 'Играть', web_app: { url: APP_URL } }]] } });
  if (t === '/id') return say(m.chat.id, 'Твой id: ' + m.from.id);
  if (t.startsWith('/') && isAdmin(m.from)) return admin(m);
}

http.createServer(async (q, s) => {
  const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json' };
  if (q.method === 'OPTIONS') { s.writeHead(204, H); return s.end(); }
  let b = ''; for await (const c of q) b += c;
  let j = {}; try { j = JSON.parse(b || '{}'); } catch {}
  const out = (o, c = 200) => { s.writeHead(c, H); s.end(JSON.stringify(o)); };
  try {
    if (q.url === '/wh/' + SECRET) { hook(j).catch(console.error); return out({ ok: 1 }); }
    if (q.url.startsWith('/api/')) {
      const u = auth(j.init); if (!u) return out({ e: 'auth' }, 401);
      const r = q.url.slice(5);
      if (r === 'me') return out(st(u));
      if (r === 'buy') {
        const a = +j.amount;
        if (!Number.isInteger(a) || a < CFG.MIN || a > CFG.MAX) return out({ e: 'amount' }, 400);
        const x = await api('createInvoiceLink', { title: `Билет ${a}☆`, description: 'Билет для апгрейда',
          payload: JSON.stringify({ u: u.id, a }), currency: 'XTR', prices: [{ label: 'Билет', amount: a }] });
        return out({ link: x.result });
      }
      if (r === 'up') {
        const k = u.t.find(k => k.id === j.id), m = +j.m;
        if (!k || !CFG.MULTS.includes(m)) return out({ e: 'bad' }, 400);
        const win = crypto.randomInt(1e6) / 1e6 < CFG.EDGE / m;
        if (win) k.v = Math.round(k.v * m); else u.t = u.t.filter(x => x !== k);
        save(); return out({ win, ...st(u) });
      }
    }
  } catch (e) { console.error(e); return out({ e: 'err' }, 500); }
  out({ ok: 1 });
}).listen(PORT, () => {
  console.log('Порт', PORT);
  if (PUBLIC_URL) api('setWebhook', { url: `${PUBLIC_URL}/wh/${SECRET}`, allowed_updates: ['message', 'pre_checkout_query'] }).then(console.log);
});
