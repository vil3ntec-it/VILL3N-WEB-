'use strict';
/*
  گفت‌وگوی سایت: بازدیدکننده از دکمهٔ «پیام» می‌نویسد؛ مالک از پنلِ سایت، از کنترول سنتر یا از تلگرام
  (از راهِ کنترول سنتر) جواب می‌دهد و جواب درجا در همان پنجره به بازدیدکننده می‌رسد.

  سه در:
    /api/chat…          بازدیدکننده (با رمزِ گفت‌وگو که فقط مرورگرِ خودش دارد؛ روی سرور فقط هشِ آن)
    /api/admin/chats…   پنلِ مالکِ همین سایت (نشستِ مالک)
    /api/panel/chats…   کنترول سنتر روی همین کامپیوتر: فقط لوکال‌هاستِ بی پراکسی + کلیدِ SITE_PANEL_KEY

  ⛔ هیچ دری بی محدودیت نیست؛ متن، تعداد و اندازه سقف دارند.
*/
const crypto = require('crypto');
const { HttpError } = require('./core/http');
const { str, id } = require('./core/util');
const telegram = require('./core/telegram');

const MAX_THREADS = 2000;
const MAX_MSGS = 300;
const TEXT_MAX = 2000;
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function install({ app, db, auth }) {
  const L = app.limiter;
  const chats = () => { if (!Array.isArray(db.data.chats)) db.data.chats = []; return db.data.chats; };
  const managed = () => !!process.env.SITE_PANEL_KEY; // کنترول سنتر خودش به تلگرام می‌برد
  const text = (v) => str(v, TEXT_MAX).replace(/\r/g, '').trim();
  const needJson = (ctx) => { if (!/application\/json/i.test(String(ctx.req.headers['content-type'] || ''))) throw new HttpError(415, 'نوع درخواست باید JSON باشد'); };
  const msgOut = (m) => ({ id: m.id, from: m.from, body: m.body, at: m.at });
  const summary = (t) => {
    const last = t.messages[t.messages.length - 1];
    return { id: t.id, name: t.name, contact: t.contact, page: t.page, status: t.status, unread: t.unread || 0, createdAt: t.createdAt, updatedAt: t.updatedAt, lastFrom: last ? last.from : '', lastMessage: last ? last.body.slice(0, 140) : '', count: t.messages.length };
  };
  const byToken = (token) => {
    const h = sha(str(token, 80));
    const t = chats().find((x) => x.tokenHash === h);
    if (!t) throw new HttpError(404, 'این گفت‌وگو پیدا نشد؛ دوباره پیام بدهید');
    return t;
  };
  const byId = (cid) => {
    const t = chats().find((x) => x.id === String(cid));
    if (!t) throw new HttpError(404, 'گفت‌وگو پیدا نشد');
    return t;
  };
  const push = (t, from, body) => {
    const m = { id: id(8), from, body, at: Date.now() };
    t.messages.push(m);
    if (t.messages.length > MAX_MSGS) t.messages.splice(0, t.messages.length - MAX_MSGS);
    t.updatedAt = m.at;
    if (from === 'visitor') { t.unread = (t.unread || 0) + 1; if (t.status === 'closed') t.status = 'open'; } else t.unread = 0;
    db.save();
    return m;
  };
  // سایتِ تنها (بی کنترول سنتر): فقط خبر به تلگرام؛ جواب از پنلِ سایت
  const notify = (t, body) => {
    if (managed()) return;
    const s = db.data.settings;
    telegram.send(s, `💬 پیامِ تازه در سایت\nاز: ${t.name}${t.contact ? ` (${t.contact})` : ''}\n\n${body}\n\nجواب: پنلِ سایت ← پیام‌ها`).catch((e) => console.error(`[تلگرام] ${e.message}`));
  };

  /* ───── بازدیدکننده ───── */
  app.post('/api/chat', async (ctx) => {
    needJson(ctx);
    const b = await ctx.readJson(8192);
    if (str(b.website, 100)) return ctx.json({ ok: true, token: '', messages: [] }); // تلهٔ ربات
    const body = text(b.text);
    if (!body) throw new HttpError(400, 'پیام خالی است');
    if (!L.hit(`chat-new:${ctx.ipKey}`, 5, 60 * 60 * 1000) || !L.hit('chat-new:all', 300, 60 * 60 * 1000)) throw new HttpError(429, 'پیام‌های زیادی فرستاده شد؛ کمی بعد دوباره امتحان کنید');
    const token = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    const t = { id: id(10), tokenHash: sha(token), name: str(b.name, 60) || 'بازدیدکننده', contact: str(b.contact, 80), page: str(b.page, 200), status: 'open', unread: 0, createdAt: now, updatedAt: now, messages: [] };
    const list = chats();
    list.unshift(t);
    if (list.length > MAX_THREADS) list.splice(MAX_THREADS);
    const m = push(t, 'visitor', body);
    db.saveNow();
    notify(t, body);
    ctx.json({ ok: true, token, messages: [msgOut(m)] });
  });

  app.post('/api/chat/:token', async (ctx) => {
    needJson(ctx);
    const t = byToken(ctx.params.token);
    const b = await ctx.readJson(8192);
    const body = text(b.text);
    if (!body) throw new HttpError(400, 'پیام خالی است');
    if (!L.hit(`chat-msg:${ctx.ipKey}`, 60, 10 * 60 * 1000) || !L.hit(`chat-thread:${t.id}`, 30, 10 * 60 * 1000)) throw new HttpError(429, 'پیام‌ها خیلی پشتِ هم است؛ کمی صبر کنید');
    const m = push(t, 'visitor', body);
    notify(t, body);
    ctx.json({ ok: true, message: msgOut(m) });
  });

  app.get('/api/chat/:token', (ctx) => {
    if (!L.hit(`chat-poll:${ctx.ipKey}`, 400, 10 * 60 * 1000)) throw new HttpError(429, 'کمی صبر کنید');
    const t = byToken(ctx.params.token);
    const after = Number(ctx.query.get('after')) || 0;
    ctx.header('Cache-Control', 'no-store');
    ctx.json({ ok: true, status: t.status, messages: t.messages.filter((m) => m.at > after).map(msgOut) });
  });

  /* ───── مالک (پنلِ سایت) و کنترول سنتر: همان کارها ───── */
  const ops = {
    list: (ctx) => {
      const since = Number(ctx.query.get('since')) || 0;
      const rows = chats().filter((t) => t.updatedAt > since).map(summary);
      ctx.header('Cache-Control', 'no-store');
      ctx.json({ ok: true, chats: rows, unread: chats().reduce((n, t) => n + (t.unread || 0), 0) });
    },
    get: (ctx, markRead) => {
      const t = byId(ctx.params.id);
      if (markRead && t.unread) { t.unread = 0; db.save(); }
      ctx.header('Cache-Control', 'no-store');
      ctx.json({ ok: true, chat: summary(t), messages: t.messages.map(msgOut) });
    },
    reply: async (ctx, via) => {
      const t = byId(ctx.params.id);
      const b = await ctx.readJson(8192);
      const body = text(b.text);
      if (!body) throw new HttpError(400, 'جواب خالی است');
      const m = push(t, 'owner', body);
      db.audit('chat-reply', `${t.name}: جواب از ${via}`, ctx.ip);
      ctx.json({ ok: true, message: msgOut(m) });
    },
    status: async (ctx) => {
      const t = byId(ctx.params.id);
      const b = await ctx.readJson(1024);
      if (!['open', 'closed'].includes(b.status)) throw new HttpError(400, 'وضعیت درست نیست');
      t.status = b.status; db.save();
      ctx.json({ ok: true, chat: summary(t) });
    },
    remove: (ctx) => {
      const list = chats();
      const i = list.findIndex((x) => x.id === String(ctx.params.id));
      if (i < 0) throw new HttpError(404, 'گفت‌وگو پیدا نشد');
      list.splice(i, 1); db.save();
      ctx.json({ ok: true });
    },
  };

  const A = '/api/admin';
  const authed = (fn) => async (ctx) => { auth.require(ctx); ctx.header('Cache-Control', 'no-store'); return fn(ctx); };
  app.get(`${A}/chats`, authed((ctx) => ops.list(ctx)));
  app.get(`${A}/chats/:id`, authed((ctx) => ops.get(ctx, true)));
  app.post(`${A}/chats/:id`, authed((ctx) => ops.reply(ctx, 'پنلِ سایت')));
  app.post(`${A}/chats/:id/status`, authed((ctx) => ops.status(ctx)));
  app.del(`${A}/chats/:id`, authed((ctx) => ops.remove(ctx)));

  // ⛔ کنترول سنتر: فقط از خودِ همین کامپیوتر (بی هیچ سرآیندِ پراکسی/تونل) و با کلیدی که خودِ پنل به سایت داده
  const panel = (fn) => (ctx) => {
    const key = process.env.SITE_PANEL_KEY || '';
    const got = String(ctx.req.headers['x-panel-key'] || '');
    const okKey = key.length >= 32 && got.length === key.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key));
    if (!ctx.local || !okKey) throw new HttpError(404, 'پیدا نشد');
    return fn(ctx);
  };
  const P = '/api/panel/chats';
  app.get(P, panel((ctx) => ops.list(ctx)));
  app.get(`${P}/:id`, panel((ctx) => ops.get(ctx, false)));
  app.post(`${P}/:id`, panel((ctx) => ops.reply(ctx, ctx.req.headers['x-panel-via'] === 'telegram' ? 'تلگرام' : 'کنترول سنتر')));
}

module.exports = { install };
