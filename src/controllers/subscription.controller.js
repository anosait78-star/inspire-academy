const Subscription = require('../models/subscription.model');
const Player = require('../models/player.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');
const { isGlobalScopeRole } = require('../utils/permissions');

// ─── Helper: resolve and verify academyId access ────────────────────────────
/**
 * Returns the academyId the request is scoped to, or throws an AppError if
 * an academy_admin tries to access a different academy.
 */
function resolveAcademyId(req, paramAcademyId) {
  // super_admin/academy_supervisor يثقان بالـ id المُمرّر؛ أي دور آخر مُقيَّد بأكاديميته.
  if (isGlobalScopeRole(req.user.role)) {
    return paramAcademyId;
  }
  return req.user.academyId?.toString();
}

// ─── POST / ──────────────────────────────────────────────────────────────────
const createSubscription = async (req, res, next) => {
  const { playerId, type, amount, startDate, endDate, notes } = req.body;

  // Determine academyId — super_admin يحدّدها، غيره مُقيَّد بأكاديميته.
  let academyId;
  if (isGlobalScopeRole(req.user.role)) {
    academyId = req.body.academyId;
    if (!academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  } else {
    academyId = req.user.academyId?.toString();
  }

  // Verify player belongs to this academy
  const player = await Player.findById(playerId);
  if (!player) return next(new AppError('اللاعب غير موجود', 404));
  if (player.academyId.toString() !== academyId.toString()) {
    return next(new AppError('اللاعب لا ينتمي إلى هذه الأكاديمية', 403));
  }

  // Optional warning check for NEW_SUBSCRIPTION: player already has subscriptions
  let warning = null;
  if (type === 'NEW_SUBSCRIPTION') {
    const existing = await Subscription.countDocuments({ playerId, academyId });
    if (existing > 0) {
      warning = 'هذا اللاعب لديه اشتراكات سابقة';
    }
  }

  const subscription = await Subscription.create({
    academyId,
    playerId,
    type,
    amount,
    startDate,
    endDate,
    notes,
  });

  logger.info(`Subscription created: ${subscription._id} for player ${playerId}`);
  logActivity(req, {
    actionType: type === 'RENEWAL' ? 'RENEW_SUBSCRIPTION' : 'ADD_SUBSCRIPTION',
    entityType: 'SUBSCRIPTION',
    entityId: subscription._id, entityName: player.fullName, academyId,
  });

  const responseData = warning
    ? { subscription, warning }
    : subscription;

  return sendSuccess(res, {
    data: responseData,
    message: 'تم إنشاء الاشتراك بنجاح',
    statusCode: 201,
  });
};

// ─── PATCH /:id/notes ────────────────────────────────────────────────────────
const updateSubscriptionNotes = async (req, res, next) => {
  const subscription = await Subscription.findById(req.params.id);
  if (!subscription) return next(new AppError('الاشتراك غير موجود', 404));

  // Academy access check
  if (
    !isGlobalScopeRole(req.user.role) &&
    subscription.academyId.toString() !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذا الاشتراك', 403));
  }

  subscription.notes = req.body.notes !== undefined ? req.body.notes : subscription.notes;
  await subscription.save();

  logger.info(`Subscription notes updated: ${subscription._id}`);
  return sendSuccess(res, { data: subscription, message: 'تم تحديث الملاحظات بنجاح' });
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── PATCH /:id/freeze ───────────────────────────────────────────────────────
const freezeSubscription = async (req, res, next) => {
  const subscription = await Subscription.findById(req.params.id);
  if (!subscription) return next(new AppError('الاشتراك غير موجود', 404));

  if (
    !isGlobalScopeRole(req.user.role) &&
    subscription.academyId.toString() !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية لتجميد هذا الاشتراك', 403));
  }

  if (subscription.isFrozen || subscription.status === 'frozen') {
    return next(new AppError('الاشتراك مُجمَّد بالفعل', 400));
  }
  if (subscription.status === 'cancelled') {
    return next(new AppError('لا يمكن تجميد اشتراك مُلغى', 400));
  }

  const now = new Date();
  const totalDays = Math.round((subscription.endDate - subscription.startDate) / MS_PER_DAY);
  const usedDays = Math.max(0, Math.min(totalDays, Math.round((now - subscription.startDate) / MS_PER_DAY)));
  const remainingDays = Math.max(0, totalDays - usedDays);

  subscription.isFrozen = true;
  subscription.status = 'frozen';
  subscription.freezeDate = now;
  subscription.resumeDate = null;
  subscription.usedDays = usedDays;
  subscription.remainingDays = remainingDays;
  await subscription.save();

  logger.info(`Subscription frozen: ${subscription._id} (remaining ${remainingDays}d)`);
  logActivity(req, {
    actionType: 'FREEZE_SUBSCRIPTION', entityType: 'SUBSCRIPTION',
    entityId: subscription._id, academyId: subscription.academyId,
  });

  return sendSuccess(res, { data: subscription, message: 'تم تجميد الاشتراك بنجاح' });
};

// ─── PATCH /:id/resume ───────────────────────────────────────────────────────
const resumeSubscription = async (req, res, next) => {
  const subscription = await Subscription.findById(req.params.id);
  if (!subscription) return next(new AppError('الاشتراك غير موجود', 404));

  if (
    !isGlobalScopeRole(req.user.role) &&
    subscription.academyId.toString() !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية لاستئناف هذا الاشتراك', 403));
  }

  if (!subscription.isFrozen || subscription.status !== 'frozen') {
    return next(new AppError('الاشتراك غير مُجمَّد', 400));
  }

  const now = new Date();
  const remainingDays = subscription.remainingDays || 0;

  // Resume completes the original subscription period — never creates a new one.
  subscription.isFrozen = false;
  subscription.status = 'active';
  subscription.resumeDate = now;
  subscription.endDate = new Date(now.getTime() + remainingDays * MS_PER_DAY);
  await subscription.save();

  logger.info(`Subscription resumed: ${subscription._id} (new endDate ${subscription.endDate.toISOString()})`);
  logActivity(req, {
    actionType: 'RESUME_SUBSCRIPTION', entityType: 'SUBSCRIPTION',
    entityId: subscription._id, academyId: subscription.academyId,
  });

  return sendSuccess(res, { data: subscription, message: 'تم استئناف الاشتراك بنجاح' });
};

// ─── DELETE /:id ─────────────────────────────────────────────────────────────
const deleteSubscription = async (req, res, next) => {
  if (req.user.role === 'academy_supervisor') {
    return next(new AppError('ليس لديك صلاحية لحذف الاشتراكات', 403));
  }

  const subscription = await Subscription.findById(req.params.id);
  if (!subscription) return next(new AppError('الاشتراك غير موجود', 404));

  // super_admin can delete any; academy_admin only their own academy
  if (
    req.user.role !== 'super_admin' &&
    subscription.academyId.toString() !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية لحذف هذا الاشتراك', 403));
  }

  await Subscription.deleteOne({ _id: subscription._id });

  const subPlayer = await Player.findById(subscription.playerId).select('fullName');
  logger.info(`Subscription deleted: ${subscription._id}`);
  logActivity(req, {
    actionType: 'DELETE_SUBSCRIPTION', entityType: 'SUBSCRIPTION',
    entityId: subscription._id, entityName: subPlayer ? subPlayer.fullName : '',
    academyId: subscription.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف الاشتراك بنجاح' });
};

// ─── GET /:id ────────────────────────────────────────────────────────────────
const getSubscriptionById = async (req, res, next) => {
  const subscription = await Subscription.findById(req.params.id)
    .populate('playerId', 'fullName playerCode')
    .populate('academyId', 'name');

  if (!subscription) return next(new AppError('الاشتراك غير موجود', 404));

  // Academy access check
  const academyIdStr =
    subscription.academyId?._id?.toString() || subscription.academyId?.toString();

  if (
    !isGlobalScopeRole(req.user.role) &&
    academyIdStr !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى هذا الاشتراك', 403));
  }

  return sendSuccess(res, { data: subscription, message: 'تم جلب بيانات الاشتراك بنجاح' });
};

// ─── GET /player/:playerId ───────────────────────────────────────────────────
const getSubscriptionsByPlayer = async (req, res, next) => {
  const { playerId } = req.params;

  // Verify player exists
  const player = await Player.findById(playerId);
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  // academy_admin can only see players from their own academy
  if (
    !isGlobalScopeRole(req.user.role) &&
    player.academyId.toString() !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى اشتراكات هذا اللاعب', 403));
  }

  const filter = { playerId };

  // Status filter using endDate comparison
  if (req.query.status === 'active') {
    filter.endDate = { $gte: new Date() };
  } else if (req.query.status === 'expired') {
    filter.endDate = { $lt: new Date() };
  }

  const subscriptions = await Subscription.find(filter).sort({ startDate: -1 });

  return sendSuccess(res, {
    data: subscriptions,
    message: 'تم جلب اشتراكات اللاعب بنجاح',
  });
};

// ─── GET /academy/:academyId ─────────────────────────────────────────────────
const getSubscriptionsByAcademy = async (req, res, next) => {
  // Resolve the target academy
  let academyId;
  if (isGlobalScopeRole(req.user.role)) {
    // بدون معرّف صريح => بدون فلتر (كل الأكاديميات).
    academyId = req.params.academyId;
  } else {
    academyId = req.user.academyId?.toString();
    // أي دور غير super مُقيَّد بأكاديميته ولا يستطيع طلب أكاديمية أخرى.
    if (req.params.academyId && req.params.academyId !== academyId) {
      return next(new AppError('ليس لديك صلاحية للوصول إلى اشتراكات هذه الأكاديمية', 403));
    }
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = {};
  if (academyId) filter.academyId = academyId;

  // Type filter
  if (req.query.type && ['NEW_SUBSCRIPTION', 'RENEWAL'].includes(req.query.type)) {
    filter.type = req.query.type;
  }

  // Status filter
  if (req.query.status === 'active') {
    filter.endDate = { $gte: new Date() };
  } else if (req.query.status === 'expired') {
    filter.endDate = { $lt: new Date() };
  }

  // Player filter
  if (req.query.playerId) {
    filter.playerId = req.query.playerId;
  }

  const [subscriptions, total] = await Promise.all([
    Subscription.find(filter)
      .populate('playerId', 'fullName playerCode')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit),
    Subscription.countDocuments(filter),
  ]);

  return sendPaginated(res, {
    data: subscriptions,
    total,
    page,
    limit,
    message: 'تم جلب اشتراكات الأكاديمية بنجاح',
  });
};

// ─── GET /academy/:academyId/revenue ─────────────────────────────────────────
const getRevenueSummary = async (req, res, next) => {
  // Resolve academy
  let academyId;
  if (isGlobalScopeRole(req.user.role)) {
    // بدون معرّف صريح => ملخص لكل الأكاديميات.
    academyId = req.params.academyId;
  } else {
    academyId = req.user.academyId?.toString();
    if (req.params.academyId && req.params.academyId !== academyId) {
      return next(new AppError('ليس لديك صلاحية للوصول إلى تقارير هذه الأكاديمية', 403));
    }
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const mongoose = require('mongoose');
  const matchStage = academyId ? { academyId: new mongoose.Types.ObjectId(academyId) } : {};

  const [summary] = await Subscription.aggregate([
    { $match: matchStage },
    {
      $facet: {
        totalRevenue: [
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ],
        monthlyRevenue: [
          {
            $match: {
              created_at: { $gte: startOfMonth, $lte: endOfMonth },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ],
        newSubscriptionsCount: [
          { $match: { type: 'NEW_SUBSCRIPTION' } },
          { $count: 'count' },
        ],
        renewalsCount: [
          { $match: { type: 'RENEWAL' } },
          { $count: 'count' },
        ],
        activeCount: [
          { $match: { endDate: { $gte: now } } },
          { $count: 'count' },
        ],
        expiredCount: [
          { $match: { endDate: { $lt: now } } },
          { $count: 'count' },
        ],
      },
    },
  ]);

  const result = {
    totalRevenue: summary?.totalRevenue?.[0]?.total ?? 0,
    monthlyRevenue: summary?.monthlyRevenue?.[0]?.total ?? 0,
    newSubscriptionsCount: summary?.newSubscriptionsCount?.[0]?.count ?? 0,
    renewalsCount: summary?.renewalsCount?.[0]?.count ?? 0,
    activeCount: summary?.activeCount?.[0]?.count ?? 0,
    expiredCount: summary?.expiredCount?.[0]?.count ?? 0,
  };

  return sendSuccess(res, {
    data: result,
    message: 'تم جلب ملخص الإيرادات بنجاح',
  });
};

module.exports = {
  createSubscription,
  updateSubscriptionNotes,
  freezeSubscription,
  resumeSubscription,
  deleteSubscription,
  getSubscriptionById,
  getSubscriptionsByPlayer,
  getSubscriptionsByAcademy,
  getRevenueSummary,
};
