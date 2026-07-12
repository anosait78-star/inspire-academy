const mongoose = require('mongoose');
const Expense = require('../models/expense.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

// Expenses are scoped by academy: super_admin sees all (optionally narrowed by
// an academyId param); academy_admin is pinned to their own academy.
const resolveExpenseAcademyId = (req) => {
  if (req.user.role === 'super_admin') return req.query.academyId || req.body.academyId || null;
  return req.user.academyId?.toString();
};

// يتحقق أن للمستخدم صلاحية على مصروف بعينه (نطاق أكاديميته).
const hasExpenseAccess = (req, expense) => {
  if (req.user.role === 'super_admin') return true;
  return expense.academyId?.toString() === req.user.academyId?.toString();
};

// ─── GET /expenses ───────────────────────────────────────────────────────────
const getExpenses = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = {};
  // تقييد بالأكاديمية لغير المدير العام.
  if (req.user.role !== 'super_admin') {
    filter.academyId = req.user.academyId;
  } else if (req.query.academyId) {
    filter.academyId = req.query.academyId;
  }
  if (req.query.category) filter.category = req.query.category;
  if (req.query.startDate || req.query.endDate) {
    filter.date = {};
    if (req.query.startDate) filter.date.$gte = req.query.startDate;
    if (req.query.endDate) filter.date.$lte = req.query.endDate;
  }

  const [expenses, total] = await Promise.all([
    Expense.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
    Expense.countDocuments(filter),
  ]);

  return sendPaginated(res, { data: expenses, total, page, limit, message: 'تم جلب المصروفات بنجاح' });
};

// ─── GET /expenses/:id ────────────────────────────────────────────────────────
const getExpenseById = async (req, res, next) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return next(new AppError('المصروف غير موجود', 404));
  if (!hasExpenseAccess(req, expense)) {
    return next(new AppError('ليس لديك صلاحية لعرض هذا المصروف', 403));
  }
  return sendSuccess(res, { data: expense, message: 'تم جلب بيانات المصروف بنجاح' });
};

// ─── POST /expenses ──────────────────────────────────────────────────────────
const createExpense = async (req, res, next) => {
  const { name, description, amount, date, category } = req.body;

  const expense = await Expense.create({
    name,
    description: description !== undefined ? description : null,
    amount,
    date,
    category,
    academyId: resolveExpenseAcademyId(req),
    createdBy: req.user._id,
  });

  logActivity(req, {
    actionType: 'ADD_EXPENSE', entityType: 'EXPENSE',
    entityId: expense._id, entityName: expense.name, academyId: expense.academyId,
  });
  return sendSuccess(res, { data: expense, message: 'تم إضافة المصروف بنجاح', statusCode: 201 });
};

// ─── PUT /expenses/:id ───────────────────────────────────────────────────────
const updateExpense = async (req, res, next) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return next(new AppError('المصروف غير موجود', 404));
  if (!hasExpenseAccess(req, expense)) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذا المصروف', 403));
  }

  const allowedFields = ['name', 'description', 'amount', 'date', 'category'];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) expense[field] = req.body[field];
  }

  await expense.save();

  logActivity(req, {
    actionType: 'UPDATE_EXPENSE', entityType: 'EXPENSE',
    entityId: expense._id, entityName: expense.name, academyId: expense.academyId,
  });
  return sendSuccess(res, { data: expense, message: 'تم تحديث المصروف بنجاح' });
};

// ─── DELETE /expenses/:id ────────────────────────────────────────────────────
const deleteExpense = async (req, res, next) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return next(new AppError('المصروف غير موجود', 404));
  if (!hasExpenseAccess(req, expense)) {
    return next(new AppError('ليس لديك صلاحية لحذف هذا المصروف', 403));
  }

  await expense.deleteOne();

  logActivity(req, {
    actionType: 'DELETE_EXPENSE', entityType: 'EXPENSE',
    entityId: expense._id, entityName: expense.name, academyId: expense.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف المصروف بنجاح' });
};

// ─── GET /expenses/report ────────────────────────────────────────────────────
const getExpenseReport = async (req, res, next) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return next(new AppError('تاريخ البداية والنهاية مطلوبان', 400));
  }

  const matchFilter = {
    date: { $gte: startDate, $lte: endDate },
  };
  // تقييد التقرير بالأكاديمية لغير المدير العام.
  const scopeAcademyId = resolveExpenseAcademyId(req);
  if (scopeAcademyId) {
    matchFilter.academyId = new mongoose.Types.ObjectId(String(scopeAcademyId));
  }

  const [byCategory, totals] = await Promise.all([
    Expense.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: matchFilter },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const byCategoryMap = {};
  byCategory.forEach((c) => {
    byCategoryMap[c._id] = { total: c.total, count: c.count };
  });

  return sendSuccess(res, {
    data: {
      totalAmount: totals[0]?.total || 0,
      totalCount: totals[0]?.count || 0,
      byCategory: byCategoryMap,
    },
    message: 'تم جلب تقرير المصروفات بنجاح',
  });
};

module.exports = {
  getExpenses, getExpenseById, createExpense, updateExpense, deleteExpense, getExpenseReport,
};
