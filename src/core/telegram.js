'use strict';
/*
  اعلانِ تلگرام برای مالک: سفارشِ تازه و مانندِ آن به ربات/گروهِ مالک می‌رود.
  ⚠️ فقط sendMessage؛ این سایت getUpdates را دائم نمی‌خواند، تا اگر همین ربات در کنترول سنتر
  برای پشتیبانی هم به کار رفت، دو خواننده سرِ پیام‌ها دعوا نکنند (خطای ۴۰۹ تلگرام).
  یافتنِ chat id فقط یک بار و با دستِ مالک (findChat) است.
*/
const TOKEN_RE = /^\d{5,12}:[A-Za-z0-9_-]{30,60}$/;
const API = process.env.VILL3N_TELEGRAM_API || 'https://api.telegram.org';

const validToken = (t) => TOKEN_RE.test(String(t || ''));
const mask = (t) => (t ? `••••${String(t).slice(-4)}` : '');

async function call(token, method, body, timeoutMs = 10000) {
  if (!validToken(token)) throw new Error('توکنِ ربات درست نیست (شکلِ 123456:ABC… از BotFather)');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ac.signal, redirect: 'error' });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description ? `تلگرام: ${String(j.description).slice(0, 160)}` : `تلگرام پاسخ نداد (${r.status})`);
    return j.result;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('تلگرام در ۱۰ ثانیه پاسخ نداد');
    throw e;
  } finally { clearTimeout(t); }
}

function send(s, text) {
  if (!s || !s.telegramNotify || !validToken(s.telegramBotToken) || !s.telegramChatId) return Promise.resolve(null);
  return call(s.telegramBotToken, 'sendMessage', { chat_id: s.telegramChatId, text: String(text).slice(0, 3900), disable_web_page_preview: true });
}

// آخرین گفت‌وگویی که به ربات /start داده — یک بار، برای پر کردنِ خودکارِ chat id
async function findChat(token) {
  const ups = await call(token, 'getUpdates', { limit: 20, timeout: 0, allowed_updates: ['message', 'my_chat_member'] });
  for (let i = ups.length - 1; i >= 0; i--) {
    const c = (ups[i].message && ups[i].message.chat) || (ups[i].my_chat_member && ups[i].my_chat_member.chat);
    if (c && c.id) return { id: String(c.id), title: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '' };
  }
  return null;
}

module.exports = { send, call, findChat, validToken, mask };
