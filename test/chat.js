'use strict';
// گفت‌وگوی سایت: بازدیدکننده ↔ پنلِ سایت ↔ درِ کنترول سنتر (کلید + فقط همین کامپیوتر)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `  →  ${extra}`}`); if (!cond) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'k'.repeat(20) + 'PanelKeyForTests_0123456789';

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-chat-'));
  const port = 9100 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, VILL3N_SUPERVISOR: '0', SITE_PANEL_KEY: KEY }, stdio: 'ignore' });
  const B = `http://127.0.0.1:${port}`;
  let cookie = '';
  const req = async (method, p, body, headers = {}) => {
    const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', 'x-v3': '1', origin: B, cookie, ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* */ }
    return { status: r.status, json, text };
  };
  const visitor = (method, p, body, ip = '9.9.9.9') => fetch(B + p, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: body !== undefined ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/healthz')).ok) break; } catch (_) { /* */ } await wait(100); }
    const code = fs.readFileSync(path.join(dataDir, 'SETUP-CODE.txt'), 'utf8').match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)[0];
    await req('POST', '/api/admin/setup', { username: 'owner', password: 'Strong-Pass-1234x', code });

    console.log('\n■ بازدیدکننده');
    const home = await (await fetch(B + '/')).text();
    ok('دکمهٔ «پیام» در صفحه هست', home.includes('data-chat-open') && home.includes('id="chat-box"'));
    let r = await visitor('POST', '/api/chat', { text: 'سلام، سایتِ سه‌بعدی می‌خواهم', name: 'سارا', contact: '0790000000', page: '/' });
    ok('گفت‌وگو ساخته شد', r.status === 200 && r.json.token && r.json.messages.length === 1, JSON.stringify(r.json));
    const token = r.json.token;
    r = await visitor('POST', `/api/chat/${token}`, { text: 'قیمتش چند است؟' });
    ok('پیامِ دوم', r.status === 200 && r.json.message.from === 'visitor');
    r = await visitor('GET', '/api/chat/notatoken');
    ok('رمزِ نادرست ⇒ ۴۰۴', r.status === 404);
    r = await visitor('POST', '/api/chat', { text: '' });
    ok('پیامِ خالی رد می‌شود', r.status === 400);

    console.log('\n■ پنلِ سایت');
    r = await req('GET', '/api/admin/chats');
    ok('در فهرستِ پنل، با یک نخوانده', r.status === 200 && r.json.chats.length === 1 && r.json.chats[0].unread === 2 && r.json.chats[0].name === 'سارا', r.text.slice(0, 200));
    ok('رمزِ بازدیدکننده در پاسخِ پنل نیست', !r.text.includes(token) && !r.text.includes('tokenHash'));
    const cid = r.json.chats[0].id;
    r = await req('GET', `/api/admin/chats/${cid}`);
    ok('باز کردن ⇒ خوانده شد', r.status === 200 && r.json.messages.length === 2 && (await req('GET', '/api/admin/chats')).json.chats[0].unread === 0);
    r = await req('POST', `/api/admin/chats/${cid}`, { text: 'سلام سارا، از ۲۰ هزار افغانی' });
    ok('جواب از پنل', r.status === 200 && r.json.message.from === 'owner');
    r = await visitor('GET', `/api/chat/${token}?after=0`);
    ok('بازدیدکننده جواب را می‌گیرد', r.json.messages.some((m) => m.from === 'owner' && /۲۰ هزار/.test(m.body)), JSON.stringify(r.json));
    const plainCookie = cookie; cookie = '';
    r = await req('GET', '/api/admin/chats');
    ok('بی ورود، پنل بسته است', r.status === 401, r.status);
    cookie = plainCookie;

    console.log('\n■ درِ کنترول سنتر');
    r = await fetch(`${B}/api/panel/chats`).then((x) => x.status);
    ok('بی کلید ⇒ ۴۰۴', r === 404, r);
    r = await fetch(`${B}/api/panel/chats`, { headers: { 'x-panel-key': KEY, 'x-forwarded-for': '1.2.3.4' } }).then((x) => x.status);
    ok('با کلید ولی از راهِ تونل ⇒ ۴۰۴', r === 404, r);
    r = await fetch(`${B}/api/panel/chats`, { headers: { 'x-panel-key': KEY.slice(0, -1) + 'x' } }).then((x) => x.status);
    ok('کلیدِ نادرست ⇒ ۴۰۴', r === 404, r);
    r = await fetch(`${B}/api/panel/chats`, { headers: { 'x-panel-key': KEY } }).then((x) => x.json());
    ok('با کلید از همین کامپیوتر', r.ok && r.chats.length === 1, JSON.stringify(r).slice(0, 200));
    r = await fetch(`${B}/api/panel/chats/${cid}`, { method: 'POST', headers: { 'x-panel-key': KEY, 'content-type': 'application/json', 'x-panel-via': 'telegram' }, body: JSON.stringify({ text: 'از تلگرام: فردا تماس می‌گیرم' }) }).then((x) => x.json());
    ok('جواب از کنترول سنتر/تلگرام', r.ok && r.message.from === 'owner');
    r = await visitor('GET', `/api/chat/${token}?after=0`);
    ok('بازدیدکننده آن را هم می‌گیرد', r.json.messages.some((m) => /فردا تماس/.test(m.body)));

    console.log('\n■ سقف‌ها');
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await visitor('POST', '/api/chat', { text: `هرزنامه ${i}` }, '5.5.5.5')).status;
    ok('بیش از ۵ گفت‌وگوی تازه از یک نشانی در ساعت ⇒ ۴۲۹', last === 429, last);
    r = await visitor('POST', `/api/chat/${token}`, { text: 'x'.repeat(5000) });
    ok('پیامِ بلند کوتاه می‌شود', r.status === 200 && r.json.message.body.length === 2000);

    console.log('\n■ پشتیبان');
    r = await req('GET', '/api/admin/backup');
    ok('پشتیبان گفت‌وگوها را دارد ولی رمز را نه', r.status === 200 && r.text.includes('سارا') && !r.text.includes(token));
    const backup = r.json;
    await req('DELETE', `/api/admin/chats/${cid}`);
    r = await req('POST', '/api/admin/restore', { data: backup, confirm: 'RESTORE' });
    ok('بازگردانی', r.status === 200, r.text.slice(0, 160));
    r = await visitor('GET', `/api/chat/${token}?after=0`);
    ok('بعد از بازگردانی، بازدیدکننده همان گفت‌وگو را دارد', r.status === 200 && r.json.messages.length >= 4, r.status);
  } finally {
    child.kill('SIGTERM');
    await wait(300);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(fail ? `\n✗ ${fail} مورد ناموفق` : '\n✓ همه سبز');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
