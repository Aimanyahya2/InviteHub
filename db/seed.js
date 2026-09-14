require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./index');

// هذا السكربت ينشئ حساب "المشرف العام" (مالك المنصة) فقط.
// حسابات المستأجرين (الموزّعين) تُنشأ من داخل لوحة المشرف العام بعد تسجيل الدخول.

const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
const password = process.env.SUPER_ADMIN_PASSWORD || 'change-this-password';

const existing = db.prepare('SELECT id FROM admins WHERE username = ? AND is_super_admin = 1').get(username);

if (existing) {
  console.log(`حساب المشرف العام "${username}" موجود مسبقًا. لا حاجة للتكرار.`);
} else {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admins (tenant_id, is_super_admin, username, password_hash) VALUES (NULL, 1, ?, ?)')
    .run(username, hash);
  console.log('تم إنشاء حساب المشرف العام بنجاح:');
  console.log(`  اسم المستخدم: ${username}`);
  console.log(`  كلمة المرور: ${password}`);
  console.log('سجّل الدخول من /super-admin/login لإدارة المستأجرين (الموزّعين).');
}
