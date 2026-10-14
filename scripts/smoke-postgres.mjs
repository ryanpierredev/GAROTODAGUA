import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (!process.env.PGDATABASE?.endsWith('_test'))
  throw new Error('Execute somente com banco descartável terminado em _test.');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:3002';
if (new URL(base).hostname !== '127.0.0.1')
  throw new Error('O teste requer servidor local.');
let cookie = '';
async function request(path, body, expected = 200) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return value;
}
assert.equal((await fetch(base)).status, 200);
assert.equal((await request('/api/auth')).setupRequired, true);
await request('/api/dashboard', undefined, 401);
const password = randomUUID();
await request('/api/auth', {
  action: 'setup',
  name: 'Admin Test',
  username: 'admin.test',
  password,
});
assert.equal((await request('/api/auth')).setupRequired, false);
await request('/api/auth', { action: 'logout' });
await request(
  '/api/auth',
  { action: 'login', username: 'admin.test', password: 'wrong-password' },
  401,
);
await request('/api/auth', {
  action: 'login',
  username: 'admin.test',
  password,
});
await request('/api/dashboard', {
  action: 'set_stock',
  total: 10,
  full: 8,
  price: 20,
  threshold: 2,
});
await request('/api/dashboard', {
  action: 'add_member',
  name: 'Pessoa Teste',
  phone: '11999999999',
});
const dashboard = await request('/api/dashboard');
assert.equal(dashboard.settings.fullBottles, 8);
assert.equal(typeof dashboard.settings.bottlePriceCents, 'number');
const memberId = dashboard.members[0].id;
assert.equal(dashboard.members[0].queuePosition, 1);
await request('/api/dashboard', { action: 'add_credit', memberId, amount: 5 });
await request('/api/dashboard', {
  action: 'charge_member',
  memberId,
  bottles: 1,
});
await request('/api/dashboard', {
  action: 'record_payment',
  memberId,
  bottles: 1,
});
await request('/api/dashboard', { action: 'report_empty', quantity: 1 });
await request('/api/dashboard', {
  action: 'add_account',
  name: 'Cliente',
  username: 'client.test',
  password,
});
await request(
  '/api/dashboard',
  {
    action: 'add_account',
    name: 'Duplicado',
    username: 'client.test',
    password,
  },
  400,
);
const updated = await request('/api/dashboard');
assert.equal(updated.settings.fullBottles, 7);
assert.equal(updated.members[0].creditCents, 0);
assert.ok(updated.payments.some((payment) => payment.status === 'paid'));
assert.ok(updated.notifications.length > 0);
assert.equal(typeof updated.events[0].createdAt, 'number');
await request('/api/auth', { action: 'logout' });
await request('/api/auth', {
  action: 'login',
  username: 'client.test',
  password,
});
await request(
  '/api/dashboard',
  { action: 'add_credit', memberId, amount: 5 },
  403,
);
await request('/api/auth', { action: 'logout' });
await request('/api/dashboard', undefined, 401);
console.log(
  'Smoke test aprovado: página, cadastro, login/logout, permissões, estoque, cotistas, crédito, cobrança e pagamento.',
);
