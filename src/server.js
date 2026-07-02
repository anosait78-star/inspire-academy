require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/database');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

const authRoutes = require('./routes/auth.routes');
const academyRoutes = require('./routes/academy.routes');
const userRoutes = require('./routes/user.routes');
const playerRoutes = require('./routes/player.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const evaluationRoutes = require('./routes/evaluation.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const staffRoutes = require('./routes/staff.routes');
const staffAttendanceRoutes = require('./routes/staffAttendance.routes');
const payrollRoutes = require('./routes/payroll.routes');
const expenseRoutes = require('./routes/expense.routes');
const matchRoutes = require('./routes/match.routes');

const app = express();

// التطبيق يعمل خلف Nginx reverse proxy واحد. نثق بأول وكيل (hop) فقط حتى يقرأ
// Express و express-rate-limit عنوان العميل الحقيقي من رأس X-Forwarded-For،
// ويُحدّد المعدّل لكل IP حقيقي بدل IP الـ Proxy. القيمة 1 (وليست true) أكثر
// أماناً لأنها تثق بوكيل واحد معروف فقط وتمنع تحذير ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// Fire-and-forget: never block route registration (incl. CORS) on this, and
// never let a connection failure crash the process — see config/database.js.
connectDB().catch(() => {});

app.use(helmet());

// Origins allowed to call this API from a browser (mobile apps via Dio don't
// send an Origin header at all, so they're unaffected by this and handled by
// the `!origin` branch below). `credentials: true` cannot be combined with a
// wildcard '*' origin per the CORS spec — browsers reject that combination
// outright — so each allowed origin must be matched explicitly/by pattern.
const allowedOriginPatterns = [
  // Flutter Web deployments for this project — both the short auto-assigned
  // domain Vercel gives every deployment (e.g. web-woad-six-93gktcydj7) and
  // the org-scoped one (e.g. web-<hash>-ahmedahmed73555-2130s-projects), plus
  // the friendlier project alias and any of its own deployment/preview URLs.
  /^https:\/\/web-[\w-]+\.vercel\.app$/,
  // Local development.
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

const isOriginAllowed = (origin) => {
  if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) return true;
  return allowedOriginPatterns.some((pattern) => pattern.test(origin));
};

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header → same-origin request or a non-browser client
    // (mobile app, curl, server-to-server). Always allow those.
    if (!origin || isOriginAllowed(origin)) return callback(null, true);
    logger.warn(`CORS: رفض الطلب من مصدر غير مسموح: ${origin}`);
    // false (not an Error) → no Access-Control-Allow-Origin header, so the
    // browser blocks it client-side, without surfacing as a server error.
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 500,
  message: { success: false, message: 'تم تجاوز الحد المسموح به من الطلبات' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Strict limiter for login only — 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'تم تجاوز الحد المسموح به من محاولات تسجيل الدخول' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));
}

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'الخادم يعمل بشكل طبيعي',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

app.use('/api/v1/auth/login', loginLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/academies', academyRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/players', playerRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/evaluations', evaluationRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/staff', staffRoutes);
app.use('/api/v1/staff-attendance', staffAttendanceRoutes);
app.use('/api/v1/payroll', payrollRoutes);
app.use('/api/v1/expenses', expenseRoutes);
app.use('/api/v1/matches', matchRoutes);

app.use(notFound);
app.use(errorHandler);

// Vercel (and most serverless hosts) import this file as a module and call
// the exported Express app directly as the request handler — they never run
// `node src/server.js`, so app.listen() must not run there. Calling listen()
// unconditionally was also the source of "ERR_SERVER_ALREADY_LISTEN": once
// the platform's compatibility shim bound its own listener to this app, any
// later re-invocation that re-ran this module tried to listen a second time
// and crashed the whole function instance — taking down unrelated in-flight
// requests (e.g. CORS preflights) with it.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`🚀 الخادم يعمل على المنفذ ${PORT} في بيئة ${process.env.NODE_ENV}`);
  });
}

// Never call process.exit() here: in serverless, this process is reused
// across concurrent/subsequent requests, so killing it on one unrelated
// rejection takes down every other request sharing that warm instance —
// which is exactly what produced the hanging/cancelled CORS preflight and
// login requests. Just log; Express's error handler deals with route errors.
process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
});

module.exports = app;
