'use strict';
/*
  به‌روزرسانی از پنلِ مدیریت — همان راهِ همیشگی، فقط با دکمه:

      GitHub ──(فقط کنترول سنتر می‌شناسد)──▶ کنترول سنتر (آینه) ──SITE_UPDATE_URL──▶ همین سایت

  «بررسی» اول از کنترول سنتر می‌خواهد همین حالا GitHub را نگاه کند (POST <آینه>/__refresh)،
  بعد release.jsonِ آینه را می‌خواند. «نصب» همان checkAndApply است (هش‌به‌هش)، و نگهبان
  (supervisor) با کدِ 75 نسخهٔ تازه را بالا می‌آورد.

  ⛔ سایت هیچ نشانیِ GitHub نمی‌شناسد و هیچ درخواستی جز به SITE_UPDATE_URL نمی‌فرستد.
  ⛔ دو نصب هم‌زمان نمی‌شود؛ پوشهٔ data و config.json دست نمی‌خورند (core/updater.js).
*/
const path = require('path');
const { HttpError } = require('./core/http');
const updater = require('./core/updater');

const ROOT = path.resolve(__dirname, '..');
const HOUR = 3600 * 1000;

function install({ app, db, auth, dataDir, VERSION }) {
  const st = { url: '', restart: null, allowed: false, busy: false, latest: null, lastCheck: 0, last: null, timers: [] };
  const base = () => (st.url.endsWith('/') ? st.url : `${st.url}/`);
  const auto = () => st.allowed && db.data.settings.autoUpdate !== false;

  async function fetchJson(url, opts = {}, ms = 30000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ac.signal, redirect: 'error', headers: { 'cache-control': 'no-cache', ...(opts.headers || {}) } });
      const j = await r.json().catch(() => null);
      return { status: r.status, body: j };
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'کنترول سنتر پاسخ نداد' : 'به کنترول سنتر وصل نشد');
    } finally { clearTimeout(t); }
  }

  /** از کنترول سنتر می‌خواهد همین حالا نسخهٔ تازه را از ریپو بگیرد (کنترول سنترِ قدیمی ⇒ بی‌صدا رد می‌شود) */
  async function refreshServer() {
    const r = await fetchJson(`${base()}__refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, 90000);
    if (r.status === 200 && r.body) return r.body;
    if (r.status === 429) return { throttled: true };
    return null;
  }

  async function check({ refresh = false } = {}) {
    if (!st.url) throw new HttpError(409, 'این سایت از کنترول سنتر اجرا نشده؛ نشانیِ به‌روزرسانی ندارد');
    let server = null;
    if (refresh) server = await refreshServer().catch(() => null);
    const r = await fetchJson(`${base()}release.json?t=${Date.now()}`);
    if (r.status !== 200 || !r.body || typeof r.body.version !== 'string') {
      throw new HttpError(502, r.status === 404 ? 'کنترول سنتر هنوز نسخه‌ای از این سایت ندارد؛ چند دقیقه بعد دوباره بررسی کنید' : 'کنترول سنتر نسخه را نداد');
    }
    st.latest = { version: r.body.version, files: Array.isArray(r.body.files) ? r.body.files.length : 0 };
    st.lastCheck = Date.now();
    return { server };
  }

  async function apply(source) {
    if (!st.url) throw new HttpError(409, 'این سایت از کنترول سنتر اجرا نشده؛ نشانیِ به‌روزرسانی ندارد');
    if (st.busy) throw new HttpError(409, 'به‌روزرسانی در جریان است');
    st.busy = true;
    try {
      const r = await updater.checkAndApply({ root: ROOT, dataDir, baseUrl: st.url, log: console.log });
      st.last = { at: Date.now(), source, status: r.status, version: r.version, from: r.from || '', changed: r.changed || 0 };
      st.latest = { ...(st.latest || {}), version: r.version };
      st.lastCheck = Date.now();
      if (r.status === 'updated') {
        db.audit('site-update', `${r.from} ← ${r.version} (${source === 'auto' ? 'خودکار' : 'از پنل'})`, '');
        db.saveNow();
        if (st.restart) setTimeout(() => st.restart(), 800).unref();
      }
      return r;
    } catch (e) {
      st.last = { at: Date.now(), source, status: 'error', error: String(e.message || e).slice(0, 300) };
      throw e;
    } finally { st.busy = false; }
  }

  function view() {
    const installed = updater.localVersion(ROOT);
    const latest = st.latest ? st.latest.version : '';
    return {
      ok: true,
      running: VERSION,
      installed,
      pendingRestart: installed !== VERSION && updater.newer(installed, VERSION),
      latest,
      available: !!latest && updater.newer(latest, installed),
      connected: !!st.url,
      canRestart: !!st.restart,
      auto: auto(),
      autoAllowed: st.allowed,
      busy: st.busy,
      lastCheck: st.lastCheck,
      last: st.last,
    };
  }

  /* ───── پنل ───── */
  const A = '/api/admin/update';
  const authed = (fn) => async (ctx) => { auth.require(ctx); ctx.header('Cache-Control', 'no-store'); return fn(ctx); };
  app.get(A, authed((ctx) => ctx.json(view())));
  app.post(`${A}/check`, authed(async (ctx) => {
    const { server } = await check({ refresh: true });
    ctx.json({ ...view(), server: server ? { changed: !!server.changed, error: server.error || '', throttled: !!server.throttled } : null });
  }));
  app.post(`${A}/apply`, authed(async (ctx) => {
    const r = await apply('panel');
    ctx.json({ ...view(), result: r, restarting: r.status === 'updated' && !!st.restart });
  }));
  app.post(`${A}/auto`, authed(async (ctx) => {
    const b = await ctx.readJson(1024);
    db.data.settings.autoUpdate = b.on === true;
    db.save();
    ctx.json(view());
  }));

  /** server.js: نشانیِ آینه، راهِ ری‌استارت، و اجازهٔ خودکار (config.json: "autoUpdate": false ⇒ نه) */
  function configure({ url, restart, allowAuto }) {
    st.url = url || '';
    st.restart = restart || null;
    st.allowed = !!allowAuto && !!st.url;
    if (!st.url) return;
    const tick = () => { if (auto() && !st.busy) apply('auto').catch((e) => console.error(`[به‌روزرسانی] ${e.message}`)); };
    const first = setTimeout(tick, Number(process.env.VILL3N_UPDATE_DELAY_MS) || 2 * 60 * 1000);
    const every = setInterval(tick, HOUR);
    if (first.unref) first.unref();
    if (every.unref) every.unref();
    st.timers.push(first, every);
  }
  function stop() { st.timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); st.timers = []; }

  return { configure, stop, check, apply, view };
}

module.exports = { install };
