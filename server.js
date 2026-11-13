// Rust-style апгрейдер для Telegram Mini App. Вся логика и права — на сервере.
const express = require('express'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const BOT_TOKEN = process.env.BOT_TOKEN, PORT = process.env.PORT || 3000, DEV = process.env.DEV === '1';
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'yung_roxy').toLowerCase().split(',').map(s => s.trim());
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean); // надёжнее username
if (!BOT_TOKEN && !DEV) { console.error('Задай BOT_TOKEN'); process.exit(1); }

const CAT = [
  ['Бинт','🩹',25],['Лом','🔧',60],['Арбалет','🏹',150],['Томпсон','🔫',350],['Метал. маска','🎭',700],
  ['Гаражная дверь','🚪',1200],['AK-47 Glory','💥',2500],['LR-300 Neon','⚡',4000],['Хазмат','☢️',6500],['Вертолёт','🚁',12000]
].map(([name, e, price], id) => ({ id, name, e, price }));

// Хранилище: Upstash Redis (бесплатно, переживает перезапуски хостинга) или локальный db.json
const REDIS = process.env.UPSTASH_REDIS_REST_URL, RTOK = process.env.UPSTASH_REDIS_REST_TOKEN;
const rpc = cmd => fetch(REDIS, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK }, body: JSON.stringify(cmd) }).then(r => r.json());
const DB = path.join(__dirname, 'db.json');
let db = { users: {}, log: [] }, pending = false;
const save = () => {
  if (REDIS) { if (pending) return; pending = true; setTimeout(() => { pending = false; rpc(['SET', 'rustdb', JSON.stringify(db)]).catch(console.error); }, 300); return; }
  fs.writeFileSync(DB + '.tmp', JSON.stringify(db)); fs.renameSync(DB + '.tmp', DB);
};
async function load() {
  if (REDIS) { const r = await rpc(['GET', 'rustdb']); if (r.result) db = JSON.parse(r.result); }
  else try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
}
const isAdmin = tg => ADMIN_IDS.includes(String(tg.id)) || ADMIN_USERNAMES.includes((tg.username || '').toLowerCase());
const view = u => ({ id: u.id, username: u.username, name: u.name, balance: u.balance, inv: u.inv });

// Проверка подписи initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
function parseInitData(raw) {
  if (DEV && raw.startsWith('dev:')) { const [, id, username] = raw.split(':'); return { id: +id, username, first_name: username }; }
  const p = new URLSearchParams(raw), hash = p.get('hash'); p.delete('hash');
  if (!hash) return null;
  const str = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

const app = express();
app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.use('/api', (req, res, next) => {
  const tg = parseInitData(String(req.body.initData || ''));
  if (!tg || !tg.id) return res.status(401).json({ error: 'Нет авторизации' });
  const u = db.users[tg.id] ||= { id: tg.id, balance: 0, inv: [] };
  u.username = tg.username || ''; u.name = tg.first_name || '';
  req.tg = tg; req.u = u; req.admin = isAdmin(tg);
  next();
});
const adminOnly = (req, res, next) => req.admin ? next() : res.status(403).json({ error: 'Только для админа' });
const fail = (res, error) => res.status(400).json({ error });

app.post('/api/me', (req, res) => { save(); res.json({ user: view(req.u), admin: req.admin, catalog: CAT }); });

app.post('/api/sell', (req, res) => {
  const u = req.u, i = u.inv.findIndex(x => x.uid === req.body.uid);
  if (i < 0) return fail(res, 'Предмет не найден');
  u.balance += CAT[u.inv[i].id].price; u.inv.splice(i, 1); save();
  res.json({ user: view(u) });
});

app.post('/api/upgrade', (req, res) => {
  const u = req.u, { uids = [], targetId } = req.body, target = CAT[targetId];
  const bet = Math.floor(Number(req.body.bet) || 0);
  if (!target) return fail(res, 'Выбери цель');
  if (bet < 0 || bet > u.balance) return fail(res, 'Не хватает баланса');
  if (!Array.isArray(uids) || new Set(uids).size !== uids.length) return fail(res, 'Ошибка ставки');
  const stake = uids.map(id => u.inv.find(i => i.uid === id));
  if (stake.some(x => !x)) return fail(res, 'Предмет не найден');
  const sum = stake.reduce((s, i) => s + CAT[i.id].price, 0) + bet;
  if (sum <= 0) return fail(res, 'Выбери предметы или поставь баланс');
  if (sum >= target.price) return fail(res, 'Цель должна быть дороже ставки');
  const chance = Math.min(90, Math.round(sum / target.price * 10000) / 100);
  if (chance < 1) return fail(res, 'Шанс меньше 1%');
  const roll = crypto.randomInt(0, 10000) / 100, win = roll < chance;
  u.inv = u.inv.filter(i => !uids.includes(i.uid)); u.balance -= bet;
  if (win) u.inv.push({ uid: crypto.randomUUID(), id: target.id });
  save();
  res.json({ win, roll, chance, user: view(u) });
});

// ---- Админка: только @yung_roxy (и ADMIN_IDS). Проверка — на сервере по подписанному initData ----
const audit = (req, text) => { db.log.push({ t: Date.now(), by: req.tg.id, text }); db.log = db.log.slice(-500); };

app.post('/api/admin/users', adminOnly, (req, res) => {
  const q = String(req.body.q || '').toLowerCase().replace('@', '');
  const list = Object.values(db.users)
    .filter(u => !q || String(u.id) === q || u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
    .slice(0, 20).map(view);
  res.json({ users: list });
});

app.post('/api/admin/balance', adminOnly, (req, res) => {
  const t = db.users[req.body.userId], amount = Math.floor(Number(req.body.amount));
  if (!t) return fail(res, 'Игрок не найден');
  if (!Number.isFinite(amount)) return fail(res, 'Некорректная сумма');
  t.balance = req.body.mode === 'set' ? amount : t.balance + amount;
  if (t.balance < 0) t.balance = 0;
  audit(req, `balance ${req.body.mode} ${amount} -> ${t.id} (теперь ${t.balance})`); save();
  res.json({ user: view(t) });
});

app.post('/api/admin/item', adminOnly, (req, res) => {
  const t = db.users[req.body.userId];
  if (!t) return fail(res, 'Игрок не найден');
  if (req.body.action === 'add') {
    if (!CAT[req.body.itemId]) return fail(res, 'Нет такого предмета');
    t.inv.push({ uid: crypto.randomUUID(), id: req.body.itemId });
  } else t.inv = t.inv.filter(i => i.uid !== req.body.uid);
  audit(req, `item ${req.body.action} ${req.body.itemId ?? req.body.uid} -> ${t.id}`); save();
  res.json({ user: view(t) });
});

load().then(() => app.listen(PORT, () => console.log('http://localhost:' + PORT)));
