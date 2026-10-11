'use strict';
// به‌روزرسانی از پنلِ مدیریت: «بررسی» ⇒ کنترول سنتر همان لحظه از ریپو می‌گیرد؛ «نصب» ⇒ هش‌به‌هش،
// و نگهبان نسخهٔ تازه را بالا می‌آورد. روی یک کپیِ جدا از همین ریپو اجرا می‌شود، نه خودِ آن.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `  →  ${extra}`}`); if (!cond) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SRC = path.join(__dirname, '..');

function copySite(dir) {
  const rel = JSON.parse(fs.readFileSync(path.join(SRC, 'release.json'), 'utf8'));
  for (const f of rel.files) { const t = path.join(dir, f.path); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(path.join(SRC, f.path), t); }
  fs.copyFileSync(path.join(SRC, 'release.json'), path.join(dir, 'release.json'));
  return rel;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-upd-'));
  const root = path.join(tmp, 'site'); const dataDir = path.join(tmp, 'data');
  const rel = copySite(root);

  // نسخهٔ تازه در «آینهٔ کنترول سنتر» (ساختگی)
  const files = new Map(rel.files.map((f) => [f.path, fs.readFileSync(path.join(root, f.path))]));
  const pkg = JSON.parse(files.get('package.json')); pkg.version = '9.9.9'; files.set('package.json', Buffer.from(JSON.stringify(pkg, null, 2)));
  files.set('public/assets/upd-test.txt', Buffer.from('new-file'));
  let published = null; let refreshes = 0;
  const publish = () => { published = { version: '9.9.9', files: [...files].map(([p, b]) => ({ path: p, size: b.length, sha256: sha(b) })) }; };
  const mirror = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname.replace(/^\/site-updates\/vill3n-top\//, ''));
    if (req.method === 'POST' && p === '__refresh') { refreshes++; publish(); res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ id: 'vill3n-top', changed: true, version: '9.9.9' })); }
    if (p === 'release.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(published || JSON.parse(fs.readFileSync(path.join(SRC, 'release.json'))))); }
    const b = published && files.get(p); if (!b) { res.writeHead(404); return res.end(); }
    res.end(b);
  });
  await new Promise((r) => mirror.listen(0, '127.0.0.1', r));
  const URLB = `http://127.0.0.1:${mirror.address().port}/site-updates/vill3n-top/`;

  const port = 9500 + Math.floor(Math.random() * 300);
  const B = `http://127.0.0.1:${port}`;
  const start = (env) => spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, VILL3N_UPDATE_DELAY_MS: '3600000', ...env }, stdio: 'ignore' });
  let child = start({ SITE_UPDATE_URL: URLB });
  let cookie = '';
  const req = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', 'x-v3': '1', origin: B, cookie }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* */ }
    return { status: r.status, json, text };
  };
  const up = async () => { for (let i = 0; i < 80; i++) { try { const r = await fetch(B + '/healthz'); if (r.ok) return r.json(); } catch (_) { /* */ } await wait(150); } return null; };
  try {
    await up();
    const code = fs.readFileSync(path.join(dataDir, 'SETUP-CODE.txt'), 'utf8').match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)[0];
    await req('POST', '/api/admin/setup', { username: 'owner', password: 'Strong-Pass-1234x', code });

    console.log('\n■ وضعیت');
    let r = await req('GET', '/api/admin/update');
    ok('وصل به کنترول سنتر، نسخهٔ فعلی', r.status === 200 && r.json.connected && r.json.running === rel.version && r.json.auto === true, r.text);
    ok('هیچ نامی از GitHub در پاسخ نیست', !/github/i.test(r.text));

    console.log('\n■ بررسی');
    r = await req('POST', '/api/admin/update/check', {});
    ok('اول از کنترول سنتر خواست همین حالا از ریپو بگیرد', refreshes === 1, refreshes);
    ok('نسخهٔ 9.9.9 آماده است', r.status === 200 && r.json.available && r.json.latest === '9.9.9', r.text);

    console.log('\n■ نصبِ خودکار');
    r = await req('POST', '/api/admin/update/auto', { on: false });
    ok('خاموش شد', r.status === 200 && r.json.auto === false);
    r = await req('POST', '/api/admin/update/auto', { on: true });
    ok('دوباره روشن شد', r.json.auto === true);

    console.log('\n■ نصب از پنل');
    r = await req('POST', '/api/admin/update/apply', {});
    ok('نصب شد و ری‌استارت در راه است', r.status === 200 && r.json.result.status === 'updated' && r.json.restarting === true, r.text);
    let v = null;
    for (let i = 0; i < 60 && v !== '9.9.9'; i++) { await wait(250); try { v = (await (await fetch(B + '/healthz')).json()).version; } catch (_) { /* در حالِ ری‌استارت */ } }
    ok('نگهبان نسخهٔ 9.9.9 را بالا آورد', v === '9.9.9', v);
    ok('فایلِ تازه سرِ جایش است', fs.readFileSync(path.join(root, 'public/assets/upd-test.txt'), 'utf8') === 'new-file');
    r = await req('GET', '/api/admin/update');
    ok('ورود و داده ماند؛ تازه‌ترین است', r.status === 200 && r.json.running === '9.9.9' && !r.json.available, r.text);
    r = await req('POST', '/api/admin/update/apply', {});
    ok('نصبِ دوباره ⇒ «تازه‌ترین است»', r.status === 200 && r.json.result.status === 'up-to-date', r.text);
    const saved = cookie; cookie = '';
    r = await req('POST', '/api/admin/update/apply', {});
    ok('بی ورود ⇒ ۴۰۱', r.status === 401, r.status);
    cookie = saved;

    console.log('\n■ بی کنترول سنتر');
    child.kill('SIGTERM'); await wait(1200);
    child = start({ SITE_UPDATE_URL: '', VILL3N_SUPERVISOR: '0' });
    await up();
    r = await req('GET', '/api/admin/update');
    ok('«وصل نیست» نشان داده می‌شود', r.status === 200 && r.json.connected === false && r.json.auto === false, r.text);
    r = await req('POST', '/api/admin/update/check', {});
    ok('بررسی ⇒ ۴۰۹ با توضیح', r.status === 409 && /کنترول سنتر/.test(r.json.error), r.text);
  } finally {
    child.kill('SIGTERM'); mirror.close(); await wait(800);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(fail ? `\n✗ ${fail} مورد شکست خورد` : '\n✓ همه سبز');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
