const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const db = require('../db');
const { requireSuperAuth } = require('../middleware/auth');

const router = express.Router();

// ---------- تسجيل دخول المشرف العام ----------
router.get('/login', (req, res) => {
  if (req.session.superAdmin) return res.redirect('/super-admin');
  res.render('super_login', { title: 'دخول المشرف العام', error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE is_super_admin = 1 AND username = ?').get(username);

  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.render('super_login', { title: 'دخول المشرف العام', error: 'بيانات الدخول غير صحيحة' });
  }

  req.session.superAdmin = { id: admin.id, username: admin.username };
  res.redirect('/super-admin');
});

router.post('/logout', (req, res) => {
  req.session.superAdmin = null;
  res.redirect('/super-admin/login');
});

router.use(requireSuperAuth);

// ---------- إعداد رفع الشعارات ----------
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `tenant-logo-${Date.now()}${ext}`);
  }
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('الملف يجب أن يكون صورة'));
    cb(null, true);
  }
});

function tenantCounts(tenantId) {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM events WHERE tenant_id = ?) AS events,
      (SELECT COUNT(*) FROM guests g JOIN events e ON g.event_id = e.id WHERE e.tenant_id = ?) AS guests
  `).get(tenantId, tenantId);
  return row;
}

// ---------- لوحة المشرف العام ----------
router.get('/', (req, res) => {
  const tenants = db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all()
    .map(t => ({ ...t, counts: tenantCounts(t.id) }));
  res.render('super_dashboard', { title: 'إدارة المستأجرين', tenants });
});

// ---------- إنشاء مستأجر جديد ----------
router.get('/tenants/new', (req, res) => {
  res.render('super_tenant_new', { title: 'مستأجر جديد', error: null });
});

router.post('/tenants', (req, res) => {
  const { name, subdomain, custom_domain, plan, admin_username, admin_password } = req.body;

  if (!name || !name.trim() || !admin_username || !admin_password) {
    return res.render('super_tenant_new', { title: 'مستأجر جديد', error: 'اسم النشاط واسم مستخدم وكلمة مرور الأدمن حقول مطلوبة' });
  }
  if (!subdomain && !custom_domain) {
    return res.render('super_tenant_new', { title: 'مستأجر جديد', error: 'لازم تحدد نطاق فرعي أو دومين مخصص على الأقل' });
  }

  try {
    const info = db.prepare(`
      INSERT INTO tenants (name, subdomain, custom_domain, plan)
      VALUES (?, ?, ?, ?)
    `).run(name.trim(), subdomain ? subdomain.trim().toLowerCase() : null, custom_domain ? custom_domain.trim().toLowerCase() : null, plan || 'تجريبي');

    const hash = bcrypt.hashSync(admin_password, 10);
    db.prepare('INSERT INTO admins (tenant_id, username, password_hash) VALUES (?, ?, ?)')
      .run(info.lastInsertRowid, admin_username.trim(), hash);

    res.redirect(`/super-admin/tenants/${info.lastInsertRowid}`);
  } catch (err) {
    res.render('super_tenant_new', { title: 'مستأجر جديد', error: 'النطاق الفرعي أو الدومين مستخدم مسبقًا' });
  }
});

// ---------- تفاصيل مستأجر ----------
router.get('/tenants/:id', (req, res) => {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).render('404', { title: 'غير موجود' });

  const admins = db.prepare('SELECT id, username, created_at FROM admins WHERE tenant_id = ?').all(req.params.id);
  const counts = tenantCounts(req.params.id);

  res.render('super_tenant_detail', {
    title: tenant.name,
    tenant,
    admins,
    counts,
    flash: req.query.flash || null
  });
});

router.post('/tenants/:id', (req, res) => {
  const { name, subdomain, custom_domain, plan, primary_color, notes } = req.body;
  try {
    db.prepare(`
      UPDATE tenants SET name = ?, subdomain = ?, custom_domain = ?, plan = ?, primary_color = ?, notes = ?
      WHERE id = ?
    `).run(
      name.trim(),
      subdomain ? subdomain.trim().toLowerCase() : null,
      custom_domain ? custom_domain.trim().toLowerCase() : null,
      plan,
      primary_color || '#8a6d3b',
      notes || null,
      req.params.id
    );
    res.redirect(`/super-admin/tenants/${req.params.id}?flash=تم الحفظ`);
  } catch (err) {
    res.redirect(`/super-admin/tenants/${req.params.id}?flash=النطاق مستخدم مسبقًا لمستأجر آخر`);
  }
});

// ---------- ربط واتساب Cloud API الخاص بالمستأجر ----------
router.post('/tenants/:id/whatsapp', (req, res) => {
  const { wa_phone_number_id, wa_access_token } = req.body;
  db.prepare('UPDATE tenants SET wa_phone_number_id = ?, wa_access_token = ? WHERE id = ?')
    .run(wa_phone_number_id || null, wa_access_token || null, req.params.id);
  res.redirect(`/super-admin/tenants/${req.params.id}?flash=تم حفظ إعداد واتساب`);
});

router.post('/tenants/:id/logo', uploadLogo.single('logo'), (req, res) => {
  if (!req.file) return res.redirect(`/super-admin/tenants/${req.params.id}?flash=لم يتم اختيار صورة`);
  db.prepare('UPDATE tenants SET logo_path = ? WHERE id = ?')
    .run(`/public/uploads/${req.file.filename}`, req.params.id);
  res.redirect(`/super-admin/tenants/${req.params.id}`);
});

router.post('/tenants/:id/status', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE tenants SET status = ? WHERE id = ?').run(status, req.params.id);
  res.redirect(`/super-admin/tenants/${req.params.id}`);
});

router.post('/tenants/:id/delete', (req, res) => {
  db.prepare('DELETE FROM tenants WHERE id = ?').run(req.params.id);
  res.redirect('/super-admin');
});

// ---------- إدارة حسابات أدمن المستأجر ----------
router.post('/tenants/:id/admins', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.redirect(`/super-admin/tenants/${req.params.id}?flash=اسم المستخدم وكلمة المرور مطلوبة`);
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO admins (tenant_id, username, password_hash) VALUES (?, ?, ?)')
      .run(req.params.id, username.trim(), hash);
    res.redirect(`/super-admin/tenants/${req.params.id}?flash=تم إنشاء حساب الدخول`);
  } catch (err) {
    res.redirect(`/super-admin/tenants/${req.params.id}?flash=اسم المستخدم موجود مسبقًا لهذا المستأجر`);
  }
});

router.post('/tenants/:tenantId/admins/:adminId/password', (req, res) => {
  const { password } = req.body;
  if (!password) return res.redirect(`/super-admin/tenants/${req.params.tenantId}?flash=كلمة المرور مطلوبة`);
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ? AND tenant_id = ?')
    .run(hash, req.params.adminId, req.params.tenantId);
  res.redirect(`/super-admin/tenants/${req.params.tenantId}?flash=تم تغيير كلمة المرور`);
});

router.post('/tenants/:tenantId/admins/:adminId/delete', (req, res) => {
  db.prepare('DELETE FROM admins WHERE id = ? AND tenant_id = ?').run(req.params.adminId, req.params.tenantId);
  res.redirect(`/super-admin/tenants/${req.params.tenantId}`);
});

module.exports = router;
