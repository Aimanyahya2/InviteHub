const cron = require('node-cron');
const db = require('../db');
const { sendWhatsAppMessage } = require('./whatsapp');

// كل ساعة، يفحص كل المناسبات النشطة ويرسل تذكير تلقائي للمدعوين
// اللي دخلوا ضمن نافذة التذكير (event_datetime - reminder_hours_before) ولسه
// ما وصلهم تذكير، بشرط إن المستأجر عنده ربط واتساب API فعّال وما اعتذروا.
function buildReminderText(event, guest) {
  const when = event.event_datetime
    ? new Date(event.event_datetime).toLocaleString('ar-SA', { dateStyle: 'full', timeStyle: 'short' })
    : (event.event_date || '');
  return `تذكير: "${event.title}" غدًا${when ? ' - ' + when : ''}${event.location ? '\nالموقع: ' + event.location : ''}\nنتشرف بحضوركم.`;
}

async function runReminderSweep() {
  const now = new Date();

  const dueEvents = db.prepare(`
    SELECT e.*, t.wa_phone_number_id, t.wa_access_token, t.id as tenant_id, t.name as tenant_name
    FROM events e
    JOIN tenants t ON e.tenant_id = t.id
    WHERE e.event_datetime IS NOT NULL
      AND t.status = 'نشط'
      AND t.wa_phone_number_id IS NOT NULL
      AND t.wa_access_token IS NOT NULL
  `).all();

  for (const event of dueEvents) {
    const eventTime = new Date(event.event_datetime);
    const reminderTime = new Date(eventTime.getTime() - (event.reminder_hours_before || 24) * 60 * 60 * 1000);

    if (now < reminderTime || now > eventTime) continue; // خارج نافذة التذكير أو المناسبة انتهت

    const guests = db.prepare(`
      SELECT * FROM guests
      WHERE event_id = ? AND reminder_sent_at IS NULL AND (rsvp IS NULL OR rsvp != 'اعتذار') AND phone != ''
    `).all(event.id);

    for (const guest of guests) {
      const phoneDigits = (guest.phone || '').replace(/[^0-9]/g, '');
      if (!phoneDigits) continue;

      try {
        await sendWhatsAppMessage(event, phoneDigits, buildReminderText(event, guest));
        db.prepare("UPDATE guests SET reminder_sent_at = datetime('now') WHERE id = ?").run(guest.id);
        console.log(`[تذكير] أُرسل لـ ${guest.name} (مناسبة: ${event.title} - مستأجر: ${event.tenant_name})`);
      } catch (err) {
        console.error(`[تذكير] فشل الإرسال لـ ${guest.name}: ${err.message}`);
      }
    }
  }
}

function startScheduler() {
  // يفحص كل ساعة على رأس الساعة
  cron.schedule('0 * * * *', () => {
    runReminderSweep().catch(err => console.error('خطأ في جولة التذكير التلقائي:', err));
  });
  console.log('جدولة التذكير التلقائي مفعّلة (تفحص كل ساعة)');
}

module.exports = { startScheduler, runReminderSweep };
