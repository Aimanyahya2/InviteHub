require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

require('./db'); // ensures schema is created

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');
const superAdminRoutes = require('./routes/superadmin');
const { resolveTenant } = require('./middleware/tenant');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // يحتاجه عند التشغيل خلف Nginx كـ reverse proxy

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12, // 12 hours
    httpOnly: true
  }
}));

app.use((req, res, next) => {
  res.locals.admin = req.session.admin || null;
  res.locals.superAdmin = req.session.superAdmin || null;
  res.locals.baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  next();
});

app.use('/super-admin', superAdminRoutes);
app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

app.get('/', resolveTenant, (req, res) => {
  res.redirect(req.session.admin && req.session.admin.tenant_id === req.tenant.id ? '/admin' : '/login');
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'الصفحة غير موجودة' });
});

app.listen(PORT, () => {
  console.log(`منصة الدعوات (Multi-Tenant) تعمل الآن على المنفذ ${PORT}`);
  console.log(`http://localhost:${PORT}`);
  startScheduler();
});
