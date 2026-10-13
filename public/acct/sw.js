/* ══ سرویس‌ورکرِ صفحهٔ «حسابِ من» — فقط برای پوش ═══════════════════════════
 *
 * «حتی مرورگرش هم که بسته بود، وقتی من پیام می‌دهم به یارو پیام برود.»
 * صاحبِ پمپ که جواب می‌دهد، ابر با web-push به همین‌جا می‌رسد و این
 * اعلان را نشان می‌دهد؛ ضربه روی اعلان همان صفحهٔ حساب را باز می‌کند
 * (نشانی داخلِ خودِ پوش است — همان لینکِ کیو‌آر).
 *
 * ⚠️ هیچ چیزی کش نمی‌شود و هیچ درخواستی دست‌کاری نمی‌شود: دادهٔ حساب داخلِ
 * خودِ کیو‌آر است و «زنده»اش از ابر می‌آید؛ کش کردنش فقط کهنه‌اش می‌کرد.
 */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) { p = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(p.title || 'پیام از پمپ', {
    body: p.body || '',
    tag: p.tag || 'pump-chat',
    renotify: true,
    dir: 'rtl',
    lang: 'fa',
    data: { url: p.url || '' },
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    //  ⛔ نشانیِ کامل، با ‎#d=…‎ (۱۴۰۵/۰۷/۱۶): همهٔ کیو‌آرها یک مسیرند و حساب
    //  داخلِ ‎#‎ است؛ برابریِ بی ‎#‎ پنجرهٔ حسابِ دیگری را جلو می‌آورد.
    for (var i = 0; i < list.length; i++) {
      if (!url || list[i].url === url) return list[i].focus();
    }
    return url ? self.clients.openWindow(url) : null;
  }));
});
