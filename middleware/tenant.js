const db = require('../db');

// يحدد المستأجر (الموزّع) بناءً على الدومين المستخدم في الطلب
// يدعم: دومين مخصص كامل (custom_domain) أو نطاق فرعي على الدومين الرئيسي للمنصة (subdomain)
function resolveTenant(req, res, next) {
  const host = (req.hostname || '').toLowerCase();
  const rootDomain = (process.env.PLATFORM_ROOT_DOMAIN || '').toLowerCase();

  let tenant = db.prepare('SELECT * FROM tenants WHERE custom_domain = ?').get(host);

  if (!tenant && rootDomain && host.endsWith('.' + rootDomain)) {
    const sub = host.slice(0, host.length - (rootDomain.length + 1));
    tenant = db.prepare('SELECT * FROM tenants WHERE subdomain = ?').get(sub);
  }

  if (!tenant) {
    return res.status(404).render('tenant_not_found', { title: 'النطاق غير مفعّل' });
  }

  if (tenant.status !== 'نشط') {
    return res.status(403).render('tenant_suspended', { title: 'الخدمة موقوفة مؤقتًا', tenant });
  }

  req.tenant = tenant;
  res.locals.tenant = tenant;
  next();
}

module.exports = { resolveTenant };
