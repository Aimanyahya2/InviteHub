const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { resolveTenant } = require('../middleware/tenant');

const router = express.Router();

router.get('/login', resolveTenant, (req, res) => {
  if (req.session.admin && req.session.admin.tenant_id === req.tenant.id) return res.redirect('/admin');
  res.render('login', { title: 'تسجيل الدخول', error: null });
});

router.post('/login', resolveTenant, (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE tenant_id = ? AND username = ?')
    .get(req.tenant.id, username);

  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.render('login', { title: 'تسجيل الدخول', error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }

  req.session.admin = { id: admin.id, username: admin.username, tenant_id: admin.tenant_id };
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.admin = null;
  res.redirect('/login');
});

module.exports = router;
