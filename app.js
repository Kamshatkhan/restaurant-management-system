const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₸';
const dateTime = value => new Date(value * 1000).toLocaleString('ru-RU');
let token = localStorage.getItem('ember-token');
let user = null;
let menu = [];
let cart = JSON.parse(localStorage.getItem('ember-cart') || '[]');
let tables = [];
let editingDishId = null;
const activeOrderStatuses = new Set(['active', 'accepted', 'preparing', 'waiting', 'pending']);
let CONTACTS = { instagram: '', whatsapp: '', map: '' };
const CONTACT_PLACEHOLDERS = { instagram: 'https://www.instagram.com/', whatsapp: 'https://wa.me/', map: 'https://2gis.kz/' };

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Ошибка');
  return data;
}
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); setTimeout(() => $('#toast').classList.remove('show'), 3000); }
function modal(selector, open) { $(selector).classList.toggle('open', open); $('#overlay').classList.toggle('show', open); }
function drawer(open) { $('#cart-drawer').classList.toggle('open', open); $('#overlay').classList.toggle('show', open); }
$('#client-modal').insertAdjacentHTML('beforeend', '<button class="text-button" id="client-logout">Выйти</button>');
$('#admin-modal').insertAdjacentHTML('beforeend', '<button class="text-button" id="admin-logout">Выйти</button>');
function renderAuthState() { $('#open-auth').textContent = user ? (user.role === 'admin' ? 'Администратор' : user.name) : 'Войти'; }
function logout() { token = null; user = null; localStorage.removeItem('ember-token'); modal('#auth-modal', false); modal('#client-modal', false); modal('#admin-modal', false); renderCart(); renderAuthState(); }
function renderMenu() {
  $('#dish-grid').innerHTML = menu.map((dish, index) => {
    const quantity = cart.find(item => item.id === dish.id)?.qty || 0;
    const action = quantity
      ? `<div class="dish-quantity" data-id="${dish.id}" aria-label="Количество: ${dish.name}"><button class="dish-quantity-button" data-id="${dish.id}" data-q="-1" aria-label="Уменьшить количество блюда">−</button><b class="dish-quantity-value">${quantity}</b><button class="dish-quantity-button" data-id="${dish.id}" data-q="1" aria-label="Увеличить количество блюда">+</button></div>`
      : `<button class="add" data-id="${dish.id}" data-q="1" aria-label="Добавить блюдо в корзину">+</button>`;
    return `<article class="dish ${dish.availability === 'unavailable' ? 'dish-unavailable' : ''}"><div class="dish-top"><span class="dish-tag">${dish.category.toUpperCase()}</span><span class="dish-tag">${String(index + 1).padStart(2, '0')}</span></div>${dish.image ? `<img class="dish-image" src="${dish.image}" alt="${dish.name}">` : ''}<div><h3>${dish.name}</h3><p>${dish.description}</p><small class="ingredients">${dish.ingredients}</small></div><div class="dish-bottom"><span class="price">${money(dish.price)}</span>${dish.availability === 'unavailable' ? '<span class="stock-label">Нет в наличии</span>' : action}</div></article>`;
  }).join('');
}
function renderCart() {
  localStorage.setItem('ember-cart', JSON.stringify(cart));
  $('#guest-card').innerHTML = user ? `<b>${user.name}</b><span>${user.role === 'admin' ? 'admin' : ''}</span><br><button id="logout">Выйти</button>` : '<b>Войдите, чтобы оформить заказ.</b><br><button id="login-now">Войти</button>';
  $('#cart-items').innerHTML = cart.length ? cart.map(item => `<div class="cart-item"><div><h4>${item.name}</h4><span>${money(item.price)} × ${item.qty} = ${money(item.price * item.qty)}</span></div><div class="qty" aria-label="Количество: ${item.name}"><button class="qty-button" data-q="-1" data-id="${item.id}" aria-label="Уменьшить количество блюда">−</button><b class="qty-value">${item.qty}</b><button class="qty-button" data-q="1" data-id="${item.id}" aria-label="Увеличить количество блюда">+</button></div></div>`).join('') : '<p class="empty">Корзина пока пуста.<br>Выберите что-нибудь из меню.</p>';
  $('#cart-count').textContent = cart.reduce((sum, item) => sum + item.qty, 0);
  $('#total').textContent = money(cart.reduce((sum, item) => sum + item.price * item.qty, 0));
  const people = Math.floor(Number($('#people-count').value) || 1);
  const oversize = people > 10;
  if ($('#capacity-warning')) $('#capacity-warning').hidden = !oversize;
  if ($('#oversize-contact')) $('#oversize-contact').hidden = false;
  $('#checkout').disabled = oversize;
  $('#table-picker').innerHTML = oversize ? '' : tables.filter(table => table.status === 'free' && Number(table.capacity) >= people).map(table => `<button class="table" data-table="${table.id}"><span>СТОЛ</span><b>${table.id}</b><small>до ${table.capacity} гостей</small></button>`).join('');
  renderMenu();
}
async function loadMenu() { menu = (await api('/api/menu')).dishes; renderMenu(); }
async function loadTables() { tables = (await api('/api/tables')).tables; renderCart(); }
$('#dish-grid').onclick = event => {
  const button = event.target.closest('[data-q][data-id]');
  if (!button) return;
  const dish = menu.find(item => item.id === Number(button.dataset.id));
  if (!dish || dish.availability !== 'available') return toast('Блюдо сейчас недоступно.');
  const item = cart.find(entry => entry.id === dish.id);
  if (item) item.qty += Number(button.dataset.q);
  else if (Number(button.dataset.q) > 0) cart.push({ id: dish.id, name: dish.name, price: dish.price, qty: 1 });
  if (item && item.qty <= 0) cart = cart.filter(entry => entry !== item);
  renderCart();
  if (Number(button.dataset.q) > 0) toast('✓ Блюдо добавлено в корзину');
};
$('#cart-items').onclick = event => { const button = event.target.closest('[data-q]'); if (!button) return; const item = cart.find(entry => entry.id === Number(button.dataset.id)); item.qty += Number(button.dataset.q); if (!item.qty) cart = cart.filter(entry => entry !== item); renderCart(); };
$('#table-picker').onclick = event => { const button = event.target.closest('[data-table]'); if (button) { document.querySelectorAll('.table').forEach(item => item.classList.remove('selected')); button.classList.add('selected'); window.selectedTable = Number(button.dataset.table); } };
$('#people-count').oninput = () => { window.selectedTable = null; renderCart(); };
function setContactLink(selector, value, label, placeholder) { const link = $(selector); if (!link) return; link.href = value || placeholder; link.setAttribute('aria-label', value ? label : `${label}: ссылка не настроена`); if (!value) link.classList.add('placeholder-link'); }
async function loadContacts() { CONTACTS = await api('/api/contacts'); setContactLink('#instagram-link', CONTACTS.instagram, 'Instagram', CONTACT_PLACEHOLDERS.instagram); setContactLink('#whatsapp-link', CONTACTS.whatsapp, 'WhatsApp', CONTACT_PLACEHOLDERS.whatsapp); setContactLink('#map-link', CONTACTS.map, '2GIS', CONTACT_PLACEHOLDERS.map); setContactLink('#oversize-contact', CONTACTS.whatsapp, 'WhatsApp', CONTACT_PLACEHOLDERS.whatsapp); renderCart(); }
$('#guest-card').onclick = event => { if (event.target.id === 'login-now') openAuthModal(); if (event.target.id === 'logout') logout(); };
$('#open-cart').onclick = () => drawer(true); $('#banner-cart').onclick = () => drawer(true); $('#close-cart').onclick = () => drawer(false); $('#overlay').onclick = () => { drawer(false); modal('#auth-modal', false); modal('#admin-modal', false); modal('#client-modal', false); };
function openAuthModal() {
  $('#auth-name').parentElement.style.display = 'none';
  $('#auth-submit').textContent = 'Войти';
  $('#toggle-auth').textContent = 'Создать аккаунт';
  $('#auth-title').textContent = 'С возвращением.';
  modal('#auth-modal', true);
}
$('#open-auth').onclick = async () => { if (!user) return openAuthModal(); if (user.role === 'admin') { await renderAdmin(); modal('#admin-modal', true); } else await openClientOrders(); };
$('#close-auth').onclick = () => modal('#auth-modal', false); $('#close-client').onclick = () => modal('#client-modal', false); $('#close-admin').onclick = () => modal('#admin-modal', false); $('#client-logout').onclick = logout; $('#admin-logout').onclick = logout;
$('#auth-form').onsubmit = async event => { event.preventDefault(); try { const mode = $('#auth-name').parentElement.style.display === 'none' ? 'login' : 'register'; const result = await api('/api/' + mode, { method: 'POST', body: JSON.stringify({ name: $('#auth-name').value, phone: $('#auth-phone').value, password: $('#auth-password').value }) }); token = result.token; localStorage.setItem('ember-token', token); user = result.user; renderAuthState(); modal('#auth-modal', false); renderCart(); if (user.role === 'admin') { await renderAdmin(); modal('#admin-modal', true); } else { await openClientOrders(); } toast('✓ ' + user.name); } catch (error) { $('#auth-error').textContent = error.message; } };
$('#toggle-auth').onclick = () => { const register = $('#auth-name').parentElement.style.display !== 'none'; $('#auth-name').parentElement.style.display = register ? 'none' : 'block'; $('#auth-submit').textContent = register ? 'Войти' : 'Создать аккаунт'; $('#toggle-auth').textContent = register ? 'Создать аккаунт' : 'Уже есть аккаунт? Войти'; };
if ($('#oversize-contact')) $('#oversize-contact').onclick = event => { if (!CONTACTS.whatsapp) { event.preventDefault(); toast('Добавьте ссылку WhatsApp в CONTACTS в app.js'); } };
$('#checkout').onclick = async () => { if (!user) return modal('#auth-modal', true); if (Number($('#people-count').value) > 10) return toast('Для компаний более 10 человек свяжитесь с рестораном в WhatsApp'); if (!cart.length || !window.selectedTable) return toast('Выберите свободный стол'); try { await api('/api/order', { method: 'POST', body: JSON.stringify({ table: window.selectedTable, items: cart.map(item => ({ id: item.id, qty: item.qty })), people: $('#people-count').value, visitDate: $('#visit-date').value }) }); cart = []; window.selectedTable = null; drawer(false); await loadTables(); toast('✓ Заказ принят'); } catch (error) { toast(error.message); await loadTables(); } };
function orderStatusLabel(status) { return ({ active: 'Принят', accepted: 'Принят', preparing: 'Готовится', waiting: 'В ожидании', pending: 'В ожидании', completed: 'Завершён', cancelled: 'Отменён' })[status] || status; }
function addItemsMarkup(order, dishes, prefix) { if (!activeOrderStatuses.has(order.status)) return ''; const availableDishes = dishes.filter(dish => dish.visible !== 0 && dish.availability === 'available'); if (!availableDishes.length) return ''; return `<div class="order-add"><button class="text-button" data-toggle-add="${prefix}-${order.id}">Добавить к заказу</button><div class="order-add-form" id="${prefix}-add-${order.id}" hidden>${availableDishes.map(dish => `<label><span>${dish.name} · ${money(dish.price)}</span><input type="number" min="0" value="0" data-add-qty="${dish.id}"></label>`).join('')}<button class="button button-main" data-confirm-add="${order.id}">Подтвердить</button></div></div>`; }
async function addItemsToOrder(orderId, form) { const items = [...form.querySelectorAll('[data-add-qty]')].map(input => ({ id: Number(input.dataset.addQty), qty: Number(input.value) })).filter(item => item.qty > 0); if (!items.length) return false; try { await api('/api/orders/' + orderId + '/items', { method: 'POST', body: JSON.stringify({ items }) }); return true; } catch (error) { toast(error.message); return false; } }
async function openClientOrders() { const orders = (await api('/api/orders')).orders; $('#client-name').textContent = user.name; $('#client-orders').innerHTML = orders.map(order => `<article class="client-order"><div class="order-heading"><b>Заказ #${order.id}</b><span>${dateTime(order.created_at)}</span></div>${order.items.map(item => `<div class="order-line"><span>${item.name} × ${item.qty}</span><span>${money(item.price * item.qty)}</span></div>`).join('')}<div class="order-total"><b>Итого</b><b>${money(order.total)}</b></div><small>Статус заказа: ${orderStatusLabel(order.status)}</small><small class="order-table">Столик: № ${order.table_id}</small><strong class="payment-status ${order.payment_status === 'paid' ? 'paid' : ''}">Оплата: ${order.payment_status === 'paid' ? 'ПРОИЗВЕДЕНА' : 'НЕ ПРОИЗВЕДЕНА'}</strong>${addItemsMarkup(order, menu, 'client')}</article>`).join('') || 'Заказов пока нет'; modal('#client-modal', true); }
$('#client-orders').onclick = async event => { const toggle = event.target.closest('[data-toggle-add]'); if (toggle) { const form = document.getElementById(toggle.dataset.toggleAdd.replace('client-', 'client-add-')); form.hidden = !form.hidden; return; } const confirmButton = event.target.closest('[data-confirm-add]'); if (confirmButton && await addItemsToOrder(confirmButton.dataset.confirmAdd, confirmButton.closest('.order-add-form'))) { await openClientOrders(); toast('✓ Заказ обновлён'); } };
function dishForm(dish = {}) { editingDishId = dish.id || null; $('#dish-name').value = dish.name || ''; $('#dish-description').value = dish.description || ''; $('#dish-price').value = dish.price || ''; $('#dish-category').value = dish.category || ''; $('#dish-ingredients').value = dish.ingredients || ''; $('#dish-image').value = dish.image || ''; $('#dish-visible').checked = dish.visible !== 0; $('#dish-availability').value = dish.availability || 'available'; $('#dish-submit').textContent = dish.id ? 'Сохранить' : 'Добавить блюдо'; }
async function renderAdmin() { const [tableData, orderData, dishData] = await Promise.all([api('/api/tables'), api('/api/orders'), api('/api/dishes')]); $('#staff-tables').innerHTML = tableData.tables.map(table => `<div class="staff-table"><div><b>Стол ${table.id}</b><span>Вместимость: ${table.capacity} · ${table.status === 'free' ? 'свободен' : 'занят'}</span></div>${table.status === 'occupied' ? `<button data-free="${table.id}">Освободить</button>` : ''}</div>`).join(''); $('#admin-orders').innerHTML = orderData.orders.map(order => `<article class="admin-order"><div class="admin-order-heading"><b>#${order.id} · ${order.guest_name}</b><strong>Столик: № ${order.table_id}</strong></div><span>${dateTime(order.created_at)} · ${orderStatusLabel(order.status)} · ${order.people} гостей</span><p>${order.items.map(item => `${item.name} × ${item.qty} — ${money(item.price * item.qty)}`).join('<br>')}</p><strong>Итого: ${money(order.total)}</strong><label class="admin-status">Статус заказа<select data-order-status="${order.id}"><option value="active" ${order.status === 'active' ? 'selected' : ''}>Принят</option><option value="preparing" ${order.status === 'preparing' ? 'selected' : ''}>Готовится</option><option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Завершён</option><option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Отменён</option></select></label><label class="admin-status">Оплата<select data-payment-status="${order.id}"><option value="unpaid" ${order.payment_status !== 'paid' ? 'selected' : ''}>Не оплачено</option><option value="paid" ${order.payment_status === 'paid' ? 'selected' : ''}>Оплачено</option></select></label>${addItemsMarkup(order, dishData.dishes, 'admin')}</article>`).join('') || 'Заказов пока нет'; $('#admin-dishes').innerHTML = dishData.dishes.map(dish => `<div class="staff-table dish-admin-row"><div><b>${dish.name}</b><span>${money(dish.price)} · ${dish.availability === 'available' ? 'В наличии' : 'Нет в наличии'} · ${dish.visible ? 'видимо' : 'скрыто'}</span></div><div><button data-edit="${dish.id}">Изменить</button><button data-delete="${dish.id}">Удалить</button></div></div>`).join(''); }
$('#admin-orders').onclick = async event => { const toggle = event.target.closest('[data-toggle-add]'); if (toggle) { const form = document.getElementById(toggle.dataset.toggleAdd.replace('admin-', 'admin-add-')); form.hidden = !form.hidden; return; } const status = event.target.closest('[data-order-status]'); const payment = event.target.closest('[data-payment-status]'); if (status || payment) { await api('/api/orders/' + (status || payment).dataset[status ? 'orderStatus' : 'paymentStatus'], { method: 'PUT', body: JSON.stringify(status ? { status: status.value } : { payment_status: payment.value }) }); toast('Сохранено'); return; } const confirmButton = event.target.closest('[data-confirm-add]'); if (confirmButton && await addItemsToOrder(confirmButton.dataset.confirmAdd, confirmButton.closest('.order-add-form'))) { await renderAdmin(); toast('✓ Заказ обновлён'); } };
$('#staff-tables').onclick = async event => { const button = event.target.closest('[data-free]'); if (button) { await api('/api/tables/' + button.dataset.free + '/free', { method: 'POST' }); await renderAdmin(); await loadTables(); } };
$('#admin-dishes').onclick = async event => { const edit = event.target.closest('[data-edit]'); const remove = event.target.closest('[data-delete]'); if (edit) dishForm((await api('/api/dishes')).dishes.find(dish => dish.id === Number(edit.dataset.edit))); if (remove && confirm('Удалить блюдо?')) { await api('/api/dishes/' + remove.dataset.delete, { method: 'DELETE' }); await renderAdmin(); await loadMenu(); } };
$('#dish-form').onsubmit = async event => { event.preventDefault(); const payload = { name: $('#dish-name').value, description: $('#dish-description').value, price: $('#dish-price').value, category: $('#dish-category').value, ingredients: $('#dish-ingredients').value, image: $('#dish-image').value, visible: $('#dish-visible').checked, availability: $('#dish-availability').value }; await api(editingDishId ? '/api/dishes/' + editingDishId : '/api/dishes', { method: editingDishId ? 'PUT' : 'POST', body: JSON.stringify(payload) }); dishForm(); await renderAdmin(); await loadMenu(); toast('Сохранено'); };
(async () => { try { if (token) user = (await api('/api/me')).user; renderAuthState(); await loadContacts(); await loadMenu(); await loadTables(); renderCart(); $('#visit-date').value = new Date().toISOString().slice(0, 10); } catch (error) { toast(error.message); } })();