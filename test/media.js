'use strict';
// عکسِ 4K و ویدیوی بزرگ: سقفِ تازهٔ عکس، ویدیوی تکه‌تکه، و «کدام بخشِ عکس در قاب»
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `  →  ${extra}`}`); if (!cond) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// PNG با سرآیندِ درست (۳۸۴۰×۲۱۶۰) و بدنهٔ بزرگ — saveImage از روی سرآیند می‌شناسد
function png(w, h, bytes) {
  const b = Buffer.alloc(bytes, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function mp4(bytes) { const b = Buffer.alloc(bytes, 3); b.write('\0\0\0\x18ftypisom', 0, 'latin1'); return b; }

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-media-'));
  const port = 8800 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, VILL3N_SUPERVISOR: '0' }, stdio: 'ignore' });
  const B = `http://127.0.0.1:${port}`;
  let cookie = '';
  const req = async (method, p, body, raw) => {
    const headers = { 'x-v3': '1', origin: B, cookie };
    if (!raw && body !== undefined) headers['content-type'] = 'application/json';
    if (raw) headers['content-type'] = 'application/octet-stream';
    const r = await fetch(B + p, { method, headers, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/healthz')).ok) break; } catch (_) { /* */ } await wait(100); }
    const code = fs.readFileSync(path.join(dataDir, 'SETUP-CODE.txt'), 'utf8').match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)[0];
    await req('POST', '/api/admin/setup', { username: 'owner', password: 'Strong-Pass-1234x', code });
    const apps = (await req('GET', '/api/admin/apps')).json.apps;
    const appId = apps[0].id;

    console.log('\n■ عکسِ 4K');
    let r = await req('POST', `/api/admin/apps/${appId}/screenshots`, png(3840, 2160, 20 * 1024 * 1024), true);
    ok('عکسِ ۲۰ مگابایتیِ 4K پذیرفته شد', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);
    r = await req('POST', `/api/admin/apps/${appId}/screenshots`, png(3840, 2160, 41 * 1024 * 1024), true);
    ok('بالای ۴۰ مگابایت رد می‌شود', r.status === 413, r.status);
    const cur = (await req('GET', `/api/admin/apps/${appId}`)).json.app;
    const shot = cur.screenshots.at(-1);
    ok('ابعادِ اصلی نگه داشته شد', shot && shot.w === 3840 && shot.h === 2160, JSON.stringify(shot));
    shot.view = 'whole';
    cur.status = 'published';
    r = await req('PUT', `/api/admin/apps/${appId}`, cur);
    ok('«کلِ عکس در قاب» ذخیره شد', r.status === 200 && (await req('GET', `/api/admin/apps/${appId}`)).json.app.screenshots.at(-1).view === 'whole', r.text.slice(0, 160));
    const page = await req('GET', `/app/${cur.slug}`);
    ok('صفحهٔ برنامه همان را نشان می‌دهد (object-fit:contain)', page.text.includes('object-fit:contain'));
    ok('عکس‌ها بزرگ‌نمایی دارند', /<img data-zoom src="\/media\//.test(page.text));
    const media = await fetch(`${B}/media/${shot.file}`);
    ok('فایلِ عکس بی‌دست‌کاری سرو می‌شود', media.status === 200 && Number(media.headers.get('content-length')) === 20 * 1024 * 1024, media.status);

    console.log('\n■ ویدیوی بزرگ، تکه‌تکه');
    cur.blocks = [{ id: 'vid1', type: 'video', title: 'آموزش' }];
    const fresh = (await req('GET', `/api/admin/apps/${appId}`)).json.app;
    fresh.blocks = [{ id: 'vid1', type: 'video', title: 'آموزش' }];
    r = await req('PUT', `/api/admin/apps/${appId}`, fresh);
    const bid = (await req('GET', `/api/admin/apps/${appId}`)).json.app.blocks[0].id;
    const size = 20 * 1024 * 1024 + 123;
    const vid = mp4(size);
    r = await req('POST', `/api/admin/apps/${appId}/blocks/${bid}/video-upload`, { size });
    ok('شروعِ بارگذاری', r.status === 200 && r.json.uploadId, r.text.slice(0, 160));
    const { uploadId, chunk } = r.json;
    let off = 0, i = 0;
    while (off < size) { const part = await req('PUT', `/api/admin/uploads/${uploadId}?i=${i}`, vid.subarray(off, off + chunk), true); if (part.status !== 200) break; off = part.json.received; i++; }
    ok(`همهٔ ${i} تکه رسید`, off === size, off);
    r = await req('POST', `/api/admin/uploads/${uploadId}/finish`, {});
    ok('ویدیو روی همان بخش نشست', r.status === 200 && r.json.video && r.json.video.size === size, r.text.slice(0, 200));
    const vr = await fetch(`${B}/media/${r.json.video.file}`, { headers: { range: 'bytes=0-99' } });
    ok('پخش با Range', vr.status === 206 && (await vr.arrayBuffer()).byteLength === 100, vr.status);
    r = await req('POST', `/api/admin/apps/${appId}/blocks/${bid}/video-upload`, { size: 50 });
    const bad = await req('PUT', `/api/admin/uploads/${r.json.uploadId}?i=0`, Buffer.alloc(50, 1), true);
    r = await req('POST', `/api/admin/uploads/${r.json.uploadId}/finish`, {});
    ok('فایلی که ویدیو نیست رد می‌شود', bad.status === 200 && r.status === 400, r.status);
  } finally {
    child.kill('SIGTERM');
    await wait(300);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(fail ? `\n✗ ${fail} مورد ناموفق` : '\n✓ همه سبز');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
