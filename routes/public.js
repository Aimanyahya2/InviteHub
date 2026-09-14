const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');

const router = express.Router();

router.get('/invite/:token', (req, res) => {
  const guest = db.prepare('SELECT * FROM guests WHERE token = ?').get(req.params.token);
  if (!guest) return res.status(404).render('404', { title: 'الدعوة غير موجودة' });

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(guest.event_id);
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(event.tenant_id);

  if (!guest.viewed_at) {
    db.prepare("UPDATE guests SET viewed_at = datetime('now'), status = CASE WHEN status = 'قيد الانتظار' THEN 'تم الإرسال' ELSE status END WHERE id = ?")
      .run(guest.id);
    guest.viewed_at = new Date().toISOString();
  }

  res.render('invite', { title: event.title, event, guest, tenant });
});

router.post('/invite/:token/rsvp', (req, res) => {
  const guest = db.prepare('SELECT * FROM guests WHERE token = ?').get(req.params.token);
  if (!guest) return res.status(404).render('404', { title: 'الدعوة غير موجودة' });

  const { answer } = req.body;
  if (answer === 'حضور' || answer === 'اعتذار') {
    db.prepare("UPDATE guests SET rsvp = ?, responded_at = datetime('now') WHERE id = ?")
      .run(answer, guest.id);
  }

  res.redirect(`/invite/${req.params.token}`);
});

// باركود المدعو الشخصي - يعرضه في هاتفه عند الباب ليُمسح عليه
router.get('/invite/:token/qrcode.png', async (req, res) => {
  const guest = db.prepare('SELECT * FROM guests WHERE token = ?').get(req.params.token);
  if (!guest) return res.status(404).send('غير موجود');
  try {
    const png = await QRCode.toBuffer(guest.token, { width: 300, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    res.status(500).send('تعذّر توليد الباركود');
  }
});

// ملف .ics لإضافة المناسبة إلى تقويم المدعو
router.get('/invite/:token/calendar.ics', (req, res) => {
  const guest = db.prepare('SELECT * FROM guests WHERE token = ?').get(req.params.token);
  if (!guest) return res.status(404).send('غير موجود');
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(guest.event_id);

  const toIcsDate = (isoLike) => {
    const d = isoLike ? new Date(isoLike) : new Date();
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const start = event.event_datetime ? toIcsDate(event.event_datetime) : toIcsDate();
  // بدون مدة محددة، نفترض ساعتين كطول افتراضي للمناسبة
  const endDate = event.event_datetime ? new Date(new Date(event.event_datetime).getTime() + 2 * 60 * 60 * 1000) : new Date(Date.now() + 2 * 60 * 60 * 1000);
  const end = toIcsDate(endDate);

  const escapeIcs = (str) => String(str || '').replace(/([,;])/g, '\\$1');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//invite-platform//AR',
    'BEGIN:VEVENT',
    `UID:${guest.token}@invite-platform`,
    `DTSTAMP:${toIcsDate()}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    event.location ? `LOCATION:${escapeIcs(event.location)}` : '',
    event.location_map_url ? `DESCRIPTION:${escapeIcs(event.location_map_url)}` : '',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="invite.ics"; filename*=UTF-8''${encodeURIComponent(event.title)}.ics`);
  res.send(ics);
});

module.exports = router;
