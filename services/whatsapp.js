// تكامل مباشر مع واتساب Cloud API الرسمي من Meta (وليس مزود وسيط).
// كل مستأجر يربط رقم واتساب بزنس خاص فيه (phone_number_id + access_token)
// من حساب Meta for Developers الخاص به، ويُخزّنان في جدول tenants.
//
// ملاحظة: هذا يرسل رسالة نصية عادية. واتساب يشترط أن أول رسالة لأي رقم
// جديد خلال 24 ساعة تكون "قالب معتمد" (Message Template) وليست رسالة حرة،
// إلا إذا كان المستخدم هو من بدأ المحادثة. للدعوة الأولى ننصح بالاستمرار
// على زر wa.me اليدوي (المستخدم نفسه من يفتح واتساب)، ونستخدم هذا التكامل
// للتذكير التلقائي بعد ما يكون تم تبادل رسائل، أو بعد ربط قالب معتمد.

const https = require('https');

function sendWhatsAppMessage(tenant, toPhoneDigitsOnly, message) {
  return new Promise((resolve, reject) => {
    if (!tenant.wa_phone_number_id || !tenant.wa_access_token) {
      return reject(new Error('لا يوجد إعداد واتساب API لهذا المستأجر'));
    }

    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhoneDigitsOnly,
      type: 'text',
      text: { body: message }
    });

    const options = {
      hostname: 'graph.facebook.com',
      path: `/v20.0/${tenant.wa_phone_number_id}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tenant.wa_access_token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`WhatsApp API error (${res.statusCode}): ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { sendWhatsAppMessage };
