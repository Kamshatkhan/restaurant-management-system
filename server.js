const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const db = new DatabaseSync(path.join(root, 'ember.db'));
const now = () => Math.floor(Date.now() / 1000);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = (res, value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const CONTACTS = { instagram: '', whatsapp: '', map: '' };

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'client',created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tables(id INTEGER PRIMARY KEY,status TEXT NOT NULL DEFAULT 'free',guest_id INTEGER,occupied_at INTEGER,capacity INTEGER NOT NULL DEFAULT 4);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,guest_id INTEGER NOT NULL,table_id INTEGER NOT NULL,items_json TEXT NOT NULL,total INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',people INTEGER NOT NULL DEFAULT 1,visit_date TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS dishes(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',price INTEGER NOT NULL,category TEXT NOT NULL DEFAULT '',ingredients TEXT NOT NULL DEFAULT '',image TEXT NOT NULL DEFAULT '',visible INTEGER NOT NULL DEFAULT 1,availability TEXT NOT NULL DEFAULT 'available',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
`);
for (const column of ['people INTEGER NOT NULL DEFAULT 1', 'visit_date TEXT']) { try { db.exec('ALTER TABLE orders ADD COLUMN ' + column); } catch {} }
try { db.exec('ALTER TABLE tables ADD COLUMN capacity INTEGER NOT NULL DEFAULT 4'); } catch {}
for (let number = 1; number <= 12; number++) db.prepare('INSERT OR IGNORE INTO tables(id) VALUES(?)').run(number);
const tableCapacities = [2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 4, 4];
for (let index = 0; index < tableCapacities.length; index++) db.prepare('UPDATE tables SET capacity=? WHERE id=?').run(tableCapacities[index], index + 1);
if (!db.prepare('SELECT id FROM users WHERE phone=?').get('admin')) db.prepare('INSERT INTO users(name,phone,password_hash,role,created_at) VALUES(?,?,?,?,?)').run('Администратор', 'admin', hash('admin123'), 'admin', now());
if (!db.prepare('SELECT id FROM dishes LIMIT 1').get()) {
  const seed = [
    ['Филе миньон', 'Говядина, овощи на гриле, соус демиглас', 8900, 'Гриль', 'говядина, овощи, соус демиглас'],
    ['Буррата с томатами', 'Сладкие томаты, базилик, оливковое масло', 3900, 'Закуски', 'буррата, томаты, базилик'],
    ['Паппарделле с уткой', 'Томлёная утка, сливочный соус', 4800, 'Паста', 'паппарделле, утка, сливки'],
    ['Шоколадный фондан', 'Ванильное мороженое, ягоды', 2900, 'Десерты', 'шоколад, ванильное мороженое, ягоды']
  ];
  const insert = db.prepare('INSERT INTO dishes(name,description,price,category,ingredients,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
  for (const dish of seed) insert.run(...dish, now(), now());
}
function currentUser(req) { const token = (req.headers.authorization || '').replace('Bearer ', ''); return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?').get(token, now()); }
function readBody(req) { return new Promise(resolve => { let value = ''; req.on('data', chunk => value += chunk); req.on('end', () => { try { resolve(JSON.parse(value || '{}')); } catch { resolve({}); } }); }); }
function startSession(res, user) { const token = crypto.randomBytes(32).toString('base64url'); db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, user.id, now() + 1209600); return json(res, { token, user: { id: user.id, name: user.name, role: user.role } }); }
function cleanDish(data) { return { name: String(data.name || '').trim(), description: String(data.description || '').trim(), price: Math.round(Number(data.price)), category: String(data.category || '').trim(), ingredients: String(data.ingredients || '').trim(), image: String(data.image || '').trim(), visible: data.visible === false || data.visible === 0 ? 0 : 1, availability: data.availability === 'unavailable' ? 'unavailable' : 'available' }; }
function validDish(dish) { return dish.name && Number.isFinite(dish.price) && dish.price >= 0 && dish.category; }
const activeOrderStatuses = new Set(['active', 'accepted', 'preparing', 'waiting', 'pending']);

const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  const data = await readBody(req);
  if (p === '/api/menu' && req.method === 'GET') return json(res, { dishes: db.prepare('SELECT * FROM dishes WHERE visible=1 ORDER BY id').all() });
  if (p === '/api/tables' && req.method === 'GET') return json(res, { tables: db.prepare('SELECT t.id,t.status,t.capacity,u.name FROM tables t LEFT JOIN users u ON u.id=t.guest_id ORDER BY t.id').all() });
  if (p === '/api/contacts' && req.method === 'GET') return json(res, CONTACTS);
  if (p === '/api/me') return json(res, { user: currentUser(req) || null });
  if (p === '/api/register' && req.method === 'POST') {
    if (!data.name || !data.phone || String(data.password || '').length < 6) return json(res, { error: 'Заполните имя, телефон и пароль (минимум 6 символов)' }, 400);
    try { const result = db.prepare('INSERT INTO users(name,phone,password_hash,created_at) VALUES(?,?,?,?)').run(data.name.trim(), data.phone.trim(), hash(data.password), now()); return startSession(res, db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid)); } catch { return json(res, { error: 'Этот номер уже зарегистрирован' }, 409); }
  }
  if (p === '/api/login' && req.method === 'POST') { const user = db.prepare('SELECT * FROM users WHERE phone=? AND password_hash=?').get(String(data.phone || '').trim(), hash(String(data.password || ''))); return user ? startSession(res, user) : json(res, { error: 'Неверный телефон или пароль' }, 401); }
  const user = currentUser(req);
  if (p.startsWith('/api/') && !user) return json(res, { error: 'Требуется вход' }, 401);
  if (p === '/api/orders' && req.method === 'GET') {
    const rows = user.role === 'admin' ? db.prepare('SELECT o.*,u.name guest_name FROM orders o JOIN users u ON u.id=o.guest_id ORDER BY o.created_at DESC').all() : db.prepare('SELECT o.*,u.name guest_name FROM orders o JOIN users u ON u.id=o.guest_id WHERE o.guest_id=? ORDER BY o.created_at DESC').all(user.id);
    return json(res, { orders: rows.map(order => ({ ...order, items: JSON.parse(order.items_json) })) });
  }
  const addItemsMatch = p.match(/^\/api\/orders\/(\d+)\/items$/);
  if (addItemsMatch && req.method === 'POST') {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(addItemsMatch[1]));
    if (!order || (user.role !== 'admin' && order.guest_id !== user.id)) return json(res, { error: 'Заказ не найден' }, 404);
    if (!activeOrderStatuses.has(order.status)) return json(res, { error: 'В этот заказ уже нельзя добавлять блюда' }, 409);
    if (!Array.isArray(data.items) || !data.items.length) return json(res, { error: 'Выберите хотя бы одно блюдо' }, 400);
    const additions = data.items.map(item => ({ id: Number(item.id), qty: Math.max(1, Math.floor(Number(item.qty))) }));
    const savedItems = JSON.parse(order.items_json);
    for (const requested of additions) {
      const dish = db.prepare('SELECT id,name,price,availability,visible FROM dishes WHERE id=?').get(requested.id);
      if (!dish || !dish.visible || dish.availability !== 'available') return json(res, { error: 'Одно из выбранных блюд сейчас недоступно.' }, 409);
      const existing = savedItems.find(item => item.id === dish.id);
      if (existing) existing.qty += requested.qty;
      else savedItems.push({ id: dish.id, name: dish.name, price: dish.price, qty: requested.qty });
    }
    const total = savedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    db.prepare('UPDATE orders SET items_json=?,total=? WHERE id=?').run(JSON.stringify(savedItems), total, order.id);
    return json(res, { ok: true, order: { ...order, items: savedItems, total, items_json: undefined } });
  }
  if (p === '/api/order' && req.method === 'POST') {
    const people = Math.floor(Number(data.people) || 1);
    if (people > 10) return json(res, { error: 'Для компаний более 10 человек требуется индивидуальное согласование с рестораном.', whatsapp: CONTACTS.whatsapp }, 422);
    if (people < 1) return json(res, { error: 'Количество гостей должно быть от 1 до 10.' }, 400);
    const table = Number(data.table); const tableRow = db.prepare('SELECT status,guest_id,capacity FROM tables WHERE id=?').get(table);
    if (tableRow && tableRow.capacity < people) return json(res, { error: 'Этот столик не рассчитан на такое количество гостей.' }, 409);
    if (!tableRow || !Array.isArray(data.items) || !data.items.length || (tableRow.status !== 'free' && tableRow.guest_id !== user.id)) return json(res, { error: 'Столик недоступен. Выберите другой.' }, 409);
    const savedItems = [];
    for (const requested of data.items.map(item => ({ id: Number(item.id), qty: Math.max(1, Math.floor(Number(item.qty))) }))) {
      const dish = db.prepare('SELECT id,name,price,availability,visible FROM dishes WHERE id=?').get(requested.id);
      if (!dish || !dish.visible || dish.availability !== 'available') return json(res, { error: 'Одно из блюд сейчас недоступно.' }, 409);
      savedItems.push({ id: dish.id, name: dish.name, price: dish.price, qty: requested.qty });
    }
    const total = savedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    if (tableRow.status === 'free') db.prepare('UPDATE tables SET status=?,guest_id=?,occupied_at=? WHERE id=?').run('occupied', user.id, now(), table);
    db.prepare('INSERT INTO orders(guest_id,table_id,items_json,total,people,visit_date,created_at) VALUES(?,?,?,?,?,?,?)').run(user.id, table, JSON.stringify(savedItems), total, people, String(data.visitDate || ''), now());
    return json(res, { ok: true });
  }
  if (p === '/api/dishes' || /^\/api\/dishes\/\d+$/.test(p)) {
    if (user.role !== 'admin') return json(res, { error: 'Только для администратора' }, 403);
    const match = p.match(/^\/api\/dishes\/(\d+)$/);
    if (p === '/api/dishes' && req.method === 'GET') return json(res, { dishes: db.prepare('SELECT * FROM dishes ORDER BY id DESC').all() });
    if (p === '/api/dishes' && req.method === 'POST') { const dish = cleanDish(data); if (!validDish(dish)) return json(res, { error: 'Название, категория и корректная цена обязательны.' }, 400); db.prepare('INSERT INTO dishes(name,description,price,category,ingredients,image,visible,availability,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(dish.name, dish.description, dish.price, dish.category, dish.ingredients, dish.image, dish.visible, dish.availability, now(), now()); return json(res, { ok: true }); }
    if (match && req.method === 'PUT') { const dish = cleanDish(data); if (!validDish(dish)) return json(res, { error: 'Название, категория и корректная цена обязательны.' }, 400); db.prepare('UPDATE dishes SET name=?,description=?,price=?,category=?,ingredients=?,image=?,visible=?,availability=?,updated_at=? WHERE id=?').run(dish.name, dish.description, dish.price, dish.category, dish.ingredients, dish.image, dish.visible, dish.availability, now(), Number(match[1])); return json(res, { ok: true }); }
    if (match && req.method === 'DELETE') { db.prepare('DELETE FROM dishes WHERE id=?').run(Number(match[1])); return json(res, { ok: true }); }
  }
  const freeTable = p.match(/^\/api\/tables\/(\d+)\/free$/);
  if (freeTable && req.method === 'POST') { if (user.role !== 'admin') return json(res, { error: 'Только для администратора' }, 403); const table = Number(freeTable[1]); db.prepare('UPDATE tables SET status=?,guest_id=NULL,occupied_at=NULL WHERE id=?').run('free', table); db.prepare('UPDATE orders SET status=? WHERE table_id=? AND status=?').run('completed', table, 'active'); return json(res, { ok: true }); }
  if (p.startsWith('/api/')) return json(res, { error: 'Не найдено' }, 404);
  const file = path.join(root, p === '/' ? 'index.html' : p);
  if (!file.startsWith(root) || !fs.existsSync(file)) return res.writeHead(404).end();
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res);
});
const PORT = process.env.PORT || 8000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`EMBER: http://localhost:${PORT}`);
});