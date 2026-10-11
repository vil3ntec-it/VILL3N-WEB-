'use strict';
// اعلانِ تلگرام و راهِ تماس: تلگرامِ ساختگی، سفارشِ واقعی، پنهان ماندنِ توکن
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `  →  ${extra}`}`); if (!cond) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = '123456789:AAHfakeTokenForTestsOnly_abcdefghijklmn';

async function main() {
  const sent = [];
  const tg = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
      res.setHeader('content-type', 'application/json');
      if (!m || m[1] !== TOKEN) return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
      if (m[2] === 'getUpdates') return res.end(JSON.stringify({ ok: true, result: [{ update_id: 1, message: { chat: { id: 5551234, first_name: 'Owner' }, text: '/start' } }] }));
      if (m[2] === 'sendMessage') { sent.push(JSON.parse(body)); return res.end(JSON.stringify({ ok: true, result: { message_id: sent.length } })); }
      res.end(JSON.stringify({ ok: false, description: 'unknown' }));
    });
  });
  await new Promise((r) => tg.listen(0, '127.0.0.1', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-tg-'));
  const port = 8400 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, VILL3N_SUPERVISOR: '0', VILL3N_TELEGRAM_API: `http://127.0.0.1:${tg.address().port}` }, stdio: 'ignore' });
  const B = `http://127.0.0.1:${port}`;
  let cookie = '';
  const req = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', 'x-v3': '1', origin: B, cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let json = null; const text = await r.text(); try { json = JSON.parse(text); } catch (_) { /* html */ }
    return { status: r.status, json, text };
  };
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/healthz')).ok) break; } catch (_) { /* */ } await wait(100); }
    const code = fs.readFileSync(path.join(dataDir, 'SETUP-CODE.txt'), 'utf8').match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)[0];
    ok('راه‌اندازی', (await req('POST', '/api/admin/setup', { username: 'owner', password: 'Strong-Pass-1234x', code })).status === 200);

    console.log('\n■ توکن');
    let r = await req('PUT', '/api/admin/settings', { telegramBotToken: 'not-a-token' });
    ok('توکنِ نادرست رد می‌شود', r.status === 400, r.status);
    r = await req('PUT', '/api/admin/settings', { telegramBotToken: TOKEN });
    ok('توکنِ درست ذخیره می‌شود و پنهان برمی‌گردد', r.status === 200 && r.json.settings.telegramBotToken === `••••${TOKEN.slice(-4)}`, JSON.stringify(r.json && r.json.settings.telegramBotToken));
    r = await req('GET', '/api/admin/settings');
    ok('GET هم توکنِ کامل نمی‌دهد', !r.text.includes(TOKEN));
    r = await req('PUT', '/api/admin/settings', r.json.settings);
    ok('ذخیرهٔ دوبارهٔ همان فرم توکن را پاک نمی‌کند', r.status === 200 && r.json.settings.telegramBotToken.endsWith(TOKEN.slice(-4)));
    r = await req('GET', '/api/admin/backup');
    ok('پشتیبان توکن ندارد', r.status === 200 && !r.text.includes(TOKEN), r.status);

    console.log('\n■ پیدا کردنِ گفت‌وگو و پیامِ آزمایشی');
    r = await req('POST', '/api/admin/telegram/find-chat', { token: `••••${TOKEN.slice(-4)}` });
    ok('chat id پیدا شد', r.status === 200 && r.json.chat.id === '5551234', r.text.slice(0, 200));
    await req('PUT', '/api/admin/settings', { telegramChatId: r.json.chat.id, telegramNotify: true, contactChannel: 'telegram', telegram: '@vill3n_support' });
    r = await req('POST', '/api/admin/telegram/test', {});
    ok('پیامِ آزمایشی رسید', r.status === 200 && sent.length === 1 && sent[0].chat_id === '5551234', r.text.slice(0, 200));

    console.log('\n■ سفارشِ تازه ⇒ تلگرام، و دکمه‌ها به تلگرام می‌روند');
    const apps = (await req('GET', '/api/admin/apps')).json.apps;
    const app = apps.find((a) => a.slug === 'vill3n-shop') || apps[0];
    const cur = (await req('GET', `/api/admin/apps/${app.id}`)).json.app;
    cur.status = 'published'; cur.plans = [{ name: 'ماهانه', period: 'month', price: 500, active: true }];
    const put = await req('PUT', `/api/admin/apps/${app.id}`, cur);
    ok('اشتراک ساخته شد', put.status === 200, put.text.slice(0, 200));
    const page = await req('GET', `/app/${app.slug}`);
    ok('دکمهٔ پرسش به تلگرام می‌رود', page.text.includes('href="https://t.me/vill3n_support"'), '');
    ok('پنجرهٔ سفارش راهِ تلگرام را دارد', page.text.includes('data-contact-kind="telegram"') && page.text.includes('فرستادن سفارش در تلگرام'));
    const full = (await req('GET', `/api/admin/apps/${app.id}`)).json;
    const planId = full && full.app && full.app.plans && full.app.plans[0] && full.app.plans[0].id;
    const before = sent.length;
    cookie = '';
    r = await req('POST', '/api/order', { appId: app.id, planId, name: 'احمد', phone: '0790000000', note: 'لطفاً زنگ بزنید' });
    await wait(500);
    ok('سفارش ثبت شد', r.status === 200 && r.json.ok, r.text.slice(0, 200));
    ok('اعلانِ سفارش به تلگرام رفت', sent.length === before + 1 && /سفارشِ تازه/.test(sent[sent.length - 1].text) && /احمد/.test(sent[sent.length - 1].text), JSON.stringify(sent[sent.length - 1]));
  } finally {
    child.kill('SIGTERM'); tg.close();
    await wait(300);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(fail ? `\n✗ ${fail} مورد ناموفق` : '\n✓ همه سبز');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
