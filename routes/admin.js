const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { parse } = require('csv-parse/sync');
const QRCode = require('qrcode');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveTenant } = require('../middleware/tenant');
const { sendWhatsAppMessage } = require('../services/whatsapp');

const router = express.Router();
router.use(resolveTenant);
router.use(requireAuth);

// ---------- إعداد رفع الملفات ----------
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const designStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `event-${req.params.id}-${Date.now()}${ext}`);
  }
});
const uploadDesign = multer({
  storage: designStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('الملف يجب أن يكون صورة'));
    cb(null, true);
  }
});
const uploadCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// ---------- أدوات مساعدة ----------
function eventStats(eventId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status != 'قيد الانتظار' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN viewed_at IS NOT NULL THEN 1 ELSE 0 END) AS viewed,
      SUM(CASE WHEN rsvp = 'حضور' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN rsvp = 'اعتذار' THEN 1 ELSE 0 END) AS declined,
      SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
    FROM guests WHERE event_id = ?
  `).get(eventId);
  return {
    total: row.total || 0,
    sent: row.sent || 0,
    viewed: row.viewed || 0,
    confirmed: row.confirmed || 0,
    declined: row.declined || 0,
    checked_in: row.checked_in || 0
  };
}

// يتأكد أن المناسبة موجودة وتابعة للمستأجر الحالي فعلاً (يمنع الوصول لمناسبات مستأجرين آخرين)
function getOwnedEvent(eventId, tenantId) {
  return db.prepare('SELECT * FROM events WHERE id = ? AND tenant_id = ?').get(eventId, tenantId);
}

// يتأكد أن المدعو تابع لمناسبة ضمن المستأجر الحالي، ويرجع المدعو مع event_id
function getOwnedGuest(guestId, tenantId) {
  return db.prepare(`
    SELECT g.* FROM guests g
    JOIN events e ON g.event_id = e.id
    WHERE g.id = ? AND e.tenant_id = ?
  `).get(guestId, tenantId);
}

// ---------- لوحة التحكم الرئيسية ----------
router.get('/', (req, res) => {
  const typeFilter = req.query.type || '';
  let events = db.prepare('SELECT * FROM events WHERE tenant_id = ? ORDER BY created_at DESC').all(req.tenant.id);

  const typeCounts = {};
  events.forEach(e => {
    const t = e.event_type || 'غير مصنّف';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  if (typeFilter) events = events.filter(e => (e.event_type || 'غير مصنّف') === typeFilter);

  const withStats = events.map(e => ({ ...e, stats: eventStats(e.id) }));
  const totalCount = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  res.render('dashboard', { title: 'لوحة التحكم', events: withStats, typeCounts, typeFilter, totalCount });
});

// ---------- إنشاء مناسبة ----------
router.get('/events/new', (req, res) => {
  res.render('event_new', { title: 'مناسبة جديدة', error: null });
});

router.post('/events', (req, res) => {
  const { title, client_name, event_date, event_datetime, reminder_hours_before, location, location_map_url, event_type, event_type_custom } = req.body;
  if (!title || !title.trim()) {
    return res.render('event_new', { title: 'مناسبة جديدة', error: 'اسم المناسبة مطلوب' });
  }
  const finalType = event_type === '__other__' ? (event_type_custom || '').trim() : (event_type || '').trim();
  const info = db.prepare(`
    INSERT INTO events (tenant_id, title, client_name, event_date, event_type, event_datetime, reminder_hours_before, location, location_map_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.tenant.id, title.trim(), client_name || null, event_date || null, finalType || null,
    event_datetime || null, reminder_hours_before ? parseInt(reminder_hours_before, 10) : 24,
    location || null, location_map_url || null
  );

  res.redirect(`/admin/events/${info.lastInsertRowid}`);
});

// ---------- تفاصيل مناسبة ----------
router.get('/events/:id', (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });

  const guests = db.prepare('SELECT * FROM guests WHERE event_id = ? ORDER BY created_at DESC').all(req.params.id);
  const stats = eventStats(req.params.id);

  res.render('event_detail', {
    title: event.title,
    event,
    guests,
    stats,
    flash: req.query.flash || null
  });
});

router.post('/events/:id/delete', (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

router.post('/events/:id/status', (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });
  db.prepare('UPDATE events SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.redirect(`/admin/events/${req.params.id}`);
});

router.post('/events/:id/type', (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });
  const finalType = req.body.event_type === '__other__' ? (req.body.event_type_custom || '').trim() : (req.body.event_type || '').trim();
  db.prepare('UPDATE events SET event_type = ? WHERE id = ?').run(finalType || null, req.params.id);
  res.redirect(`/admin/events/${req.params.id}`);
});

router.post('/events/:id/schedule', (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });
  const { event_datetime, reminder_hours_before } = req.body;
  db.prepare('UPDATE events SET event_datetime = ?, reminder_hours_before = ? WHERE id = ?')
    .run(event_datetime || null, reminder_hours_before ? parseInt(reminder_hours_before, 10) : 24, req.params.id);
  res.redirect(`/admin/events/${req.params.id}?flash=تم حفظ إعداد التذكير`);
});

// ---------- رفع تصميم الدعوة ----------
router.post('/events/:id/design', uploadDesign.single('design'), (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });
  if (!req.file) return res.redirect(`/admin/events/${req.params.id}?flash=لم يتم اختيار صورة`);
  db.prepare('UPDATE events SET design_image = ? WHERE id = ?')
    .run(`/public/uploads/${req.file.filename}`, req.params.id);
  res.redirect(`/admin/events/${req.params.id}`);
});

// ---------- إضافة مدعو يدويًا ----------
router.post('/events/:id/guests', (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });

  const { name, phone } = req.body;
  if (!name || !name.trim()) {
    return res.redirect(`/admin/events/${req.params.id}?flash=اسم المدعو مطلوب`);
  }
  const token = uuidv4().split('-')[0];
  db.prepare('INSERT INTO guests (event_id, name, phone, token) VALUES (?, ?, ?, ?)')
    .run(req.params.id, name.trim(), (phone || '').trim(), token);
  res.redirect(`/admin/events/${req.params.id}`);
});

// ---------- استيراد مدعوين من CSV ----------
router.post('/events/:id/guests/import', uploadCsv.single('file'), (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });
  if (!req.file) return res.redirect(`/admin/events/${req.params.id}?flash=لم يتم اختيار ملف`);

  let records;
  try {
    records = parse(req.file.buffer.toString('utf-8'), {
      columns: false,
      skip_empty_lines: true,
      trim: true
    });
  } catch (err) {
    return res.redirect(`/admin/events/${req.params.id}?flash=تعذّر قراءة الملف، تأكد أنه CSV صالح`);
  }

  const insert = db.prepare('INSERT INTO guests (event_id, name, phone, token) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((rows) => {
    let count = 0;
    for (const row of rows) {
      const [rawName, rawPhone] = row;
      if (!rawName) continue;
      const nameLower = String(rawName).trim().toLowerCase();
      if (nameLower === 'name' || nameLower === 'الاسم') continue;
      const token = uuidv4().split('-')[0];
      insert.run(req.params.id, String(rawName).trim(), rawPhone ? String(rawPhone).trim() : '', token);
      count++;
    }
    return count;
  });

  const count = insertMany(records);
  res.redirect(`/admin/events/${req.params.id}?flash=تم استيراد ${count} مدعو بنجاح`);
});

// ---------- تحديث حالة الإرسال يدويًا ----------
router.post('/guests/:id/status', (req, res) => {
  const guest = getOwnedGuest(req.params.id, req.tenant.id);
  if (!guest) return res.status(404).send('غير موجود');
  db.prepare('UPDATE guests SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.redirect(`/admin/events/${guest.event_id}`);
});

router.post('/guests/:id/delete', (req, res) => {
  const guest = getOwnedGuest(req.params.id, req.tenant.id);
  if (!guest) return res.status(404).send('غير موجود');
  db.prepare('DELETE FROM guests WHERE id = ?').run(req.params.id);
  res.redirect(`/admin/events/${guest.event_id}`);
});

// ---------- تصدير تقرير CSV ----------
router.get('/events/:id/export', (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).send('غير موجود');
  const guests = db.prepare('SELECT * FROM guests WHERE event_id = ?').all(req.params.id);

  let csv = 'الاسم,الجوال,حالة الإرسال,تمت المشاهدة,الرد\n';
  for (const g of guests) {
    csv += `${g.name},${g.phone || ''},${g.status},${g.viewed_at ? 'نعم' : 'لا'},${g.rsvp || '-'}\n`;
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="guests-${event.id}.csv"`);
  res.send('\uFEFF' + csv);
});

// ---------- باركود المدعو (لعرضه بصفحة الدعوة أو طباعته) ----------
router.get('/guests/:id/qrcode.png', async (req, res) => {
  const guest = getOwnedGuest(req.params.id, req.tenant.id);
  if (!guest) return res.status(404).send('غير موجود');
  try {
    const png = await QRCode.toBuffer(guest.token, { width: 300, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    res.status(500).send('تعذّر توليد الباركود');
  }
});

// ---------- ورقة طباعة كل الباركودات دفعة وحدة ----------
router.get('/events/:id/qrcodes', async (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });
  const guests = db.prepare('SELECT * FROM guests WHERE event_id = ? ORDER BY name').all(req.params.id);

  const guestsWithQr = await Promise.all(guests.map(async (g) => ({
    ...g,
    qrDataUrl: await QRCode.toDataURL(g.token, { width: 180, margin: 1 })
  })));

  res.render('event_qrcodes', { title: 'باركودات المدعوين', event, guests: guestsWithQr });
});

// ---------- صفحة الماسح الضوئي (تسجيل الحضور عند الباب) ----------
router.get('/events/:id/scan', (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });
  const stats = eventStats(req.params.id);
  res.render('event_scan', { title: 'تسجيل الحضور', event, stats });
});

// ---------- معالجة مسح الباركود: تسجيل حضور المدعو ----------
router.post('/checkin/:token', (req, res) => {
  const guest = db.prepare(`
    SELECT g.* FROM guests g JOIN events e ON g.event_id = e.id
    WHERE g.token = ? AND e.tenant_id = ?
  `).get(req.params.token, req.tenant.id);

  if (!guest) return res.status(404).json({ ok: false, message: 'باركود غير معروف' });

  if (guest.checked_in_at) {
    return res.json({ ok: false, already: true, name: guest.name, message: `${guest.name} مسجّل حضوره مسبقًا` });
  }

  db.prepare("UPDATE guests SET checked_in_at = datetime('now') WHERE id = ?").run(guest.id);
  const stats = eventStats(guest.event_id);
  res.json({ ok: true, name: guest.name, checked_in: stats.checked_in, total: stats.total });
});

// ---------- إرسال رسالة جماعية عبر واتساب Cloud API (يحتاج ربط API للمستأجر) ----------
router.post('/events/:id/broadcast', async (req, res) => {
  const event = getOwnedEvent(req.params.id, req.tenant.id);
  if (!event) return res.status(404).render('404', { title: 'غير موجود' });

  if (!req.tenant.wa_phone_number_id || !req.tenant.wa_access_token) {
    return res.redirect(`/admin/events/${req.params.id}?flash=ما فيه ربط واتساب API لهذا الحساب بعد - تواصل مع مزوّد المنصة`);
  }

  const { message, target } = req.body;
  if (!message || !message.trim()) {
    return res.redirect(`/admin/events/${req.params.id}?flash=نص الرسالة مطلوب`);
  }

  let guests = db.prepare('SELECT * FROM guests WHERE event_id = ?').all(req.params.id);
  if (target === 'confirmed') guests = guests.filter(g => g.rsvp === 'حضور');
  if (target === 'pending') guests = guests.filter(g => !g.rsvp);

  let sent = 0, failed = 0;
  for (const g of guests) {
    const phoneDigits = (g.phone || '').replace(/[^0-9]/g, '');
    if (!phoneDigits) { failed++; continue; }
    try {
      await sendWhatsAppMessage(req.tenant, phoneDigits, message.trim());
      sent++;
    } catch (err) {
      failed++;
    }
  }

  res.redirect(`/admin/events/${req.params.id}?flash=تم الإرسال: ${sent} نجح${failed ? ' / ' + failed + ' فشل' : ''}`);
});

module.exports = router;
