// يتأكد أن هناك مدير مسجل دخول وأنه فعلاً ينتمي للمستأجر الحالي (الدومين الحالي)
// هذا يمنع أي احتمال لاستخدام جلسة دخول من مستأجر لدخول لوحة مستأجر آخر
function requireAuth(req, res, next) {
  if (!req.session.admin || !req.tenant || req.session.admin.tenant_id !== req.tenant.id) {
    return res.redirect('/login');
  }
  next();
}

function requireSuperAuth(req, res, next) {
  if (!req.session.superAdmin) {
    return res.redirect('/super-admin/login');
  }
  next();
}

module.exports = { requireAuth, requireSuperAuth };
