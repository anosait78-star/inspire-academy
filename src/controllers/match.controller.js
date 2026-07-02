const Match = require('../models/match.model');
const Player = require('../models/player.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');

const resolveAcademyFilter = (req, filter) => {
  if (req.user.role === 'super_admin') {
    // بدون academyId صريح → بدون فلتر (كل الأكاديميات).
    const academyId = req.query.academyId || req.body.academyId;
    if (academyId) filter.academyId = academyId;
  } else {
    filter.academyId = req.user.academyId;
  }
};

// ─── GET /matches ────────────────────────────────────────────────────────────
const getMatches = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = {};
  try {
    resolveAcademyFilter(req, filter);
  } catch (err) {
    return next(err);
  }

  if (req.query.sport && req.query.sport.trim().length > 0) {
    filter.sport = req.query.sport.trim();
  }

  const [matches, total] = await Promise.all([
    Match.find(filter).sort({ date: -1, time: -1 }).skip(skip).limit(limit),
    Match.countDocuments(filter),
  ]);

  return sendPaginated(res, {
    data: matches,
    total,
    page,
    limit,
    message: 'تم جلب المباريات بنجاح',
  });
};

// ─── GET /matches/:id ────────────────────────────────────────────────────────
const getMatchById = async (req, res, next) => {
  const match = await Match.findById(req.params.id);
  if (!match) return next(new AppError('المباراة غير موجودة', 404));

  if (req.user.role !== 'super_admin' &&
      match.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى هذه المباراة', 403));
  }

  const players = await Player.find({ _id: { $in: match.playerIds } });

  return sendSuccess(res, {
    data: { ...match.toJSON(), players },
    message: 'تم جلب بيانات المباراة بنجاح',
  });
};

// ─── POST /matches ───────────────────────────────────────────────────────────
const createMatch = async (req, res, next) => {
  let academyId;
  if (req.user.role === 'super_admin') {
    academyId = req.body.academyId;
    if (!academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  } else {
    academyId = req.user.academyId;
  }

  const { name, location, date, time, notes, sport } = req.body;

  const matchData = { academyId, name, location, date, time };
  if (notes !== undefined) matchData.notes = notes;
  if (sport !== undefined) matchData.sport = sport;

  const match = await Match.create(matchData);

  logger.info(`Match created: ${match.name}`);
  logActivity(req, {
    actionType: 'CREATE_MATCH', entityType: 'MATCH',
    entityId: match._id, entityName: match.name, academyId: match.academyId,
  });
  return sendSuccess(res, { data: match, message: 'تم إنشاء المباراة بنجاح', statusCode: 201 });
};

// ─── PUT /matches/:id ────────────────────────────────────────────────────────
const updateMatch = async (req, res, next) => {
  const match = await Match.findById(req.params.id);
  if (!match) return next(new AppError('المباراة غير موجودة', 404));

  if (req.user.role !== 'super_admin' &&
      match.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذه المباراة', 403));
  }

  const allowedFields = ['name', 'location', 'date', 'time', 'notes', 'sport'];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      match[field] = req.body[field];
    }
  }

  await match.save();

  logActivity(req, {
    actionType: 'UPDATE_MATCH', entityType: 'MATCH',
    entityId: match._id, entityName: match.name, academyId: match.academyId,
  });
  return sendSuccess(res, { data: match, message: 'تم تحديث المباراة بنجاح' });
};

// ─── DELETE /matches/:id ─────────────────────────────────────────────────────
const deleteMatch = async (req, res, next) => {
  const match = await Match.findById(req.params.id);
  if (!match) return next(new AppError('المباراة غير موجودة', 404));

  if (req.user.role !== 'super_admin' &&
      match.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لحذف هذه المباراة', 403));
  }

  await match.deleteOne();

  logActivity(req, {
    actionType: 'DELETE_MATCH', entityType: 'MATCH',
    entityId: match._id, entityName: match.name, academyId: match.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف المباراة بنجاح' });
};

// ─── POST /matches/:id/players ───────────────────────────────────────────────
const addPlayersToMatch = async (req, res, next) => {
  const match = await Match.findById(req.params.id);
  if (!match) return next(new AppError('المباراة غير موجودة', 404));

  if (req.user.role !== 'super_admin' &&
      match.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذه المباراة', 403));
  }

  const { playerIds } = req.body;
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    return next(new AppError('قائمة اللاعبين مطلوبة', 400));
  }

  const existing = new Set(match.playerIds.map((id) => id.toString()));
  playerIds.forEach((id) => existing.add(String(id)));
  match.playerIds = Array.from(existing);

  await match.save();

  return sendSuccess(res, { data: match, message: 'تم إضافة اللاعبين بنجاح' });
};

// ─── DELETE /matches/:id/players/:playerId ───────────────────────────────────
const removePlayerFromMatch = async (req, res, next) => {
  const match = await Match.findById(req.params.id);
  if (!match) return next(new AppError('المباراة غير موجودة', 404));

  if (req.user.role !== 'super_admin' &&
      match.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذه المباراة', 403));
  }

  match.playerIds = match.playerIds.filter(
    (id) => id.toString() !== req.params.playerId
  );
  await match.save();

  return sendSuccess(res, { data: match, message: 'تم إزالة اللاعب بنجاح' });
};

// ─── POST /matches/:id/reminders/:playerId ───────────────────────────────────
// Logs that a WhatsApp reminder was sent for a given player (the actual sending
// happens client-side via url_launcher / wa.me).
const logReminder = async (req, res, next) => {
  const match = await Match.findById(req.params.id);
  if (!match) return next(new AppError('المباراة غير موجودة', 404));

  if (req.user.role !== 'super_admin' &&
      match.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذه المباراة', 403));
  }

  match.reminderLog.push({ playerId: req.params.playerId, sentAt: new Date() });
  await match.save();

  return sendSuccess(res, { data: match, message: 'تم تسجيل التذكير بنجاح' });
};

module.exports = {
  getMatches,
  getMatchById,
  createMatch,
  updateMatch,
  deleteMatch,
  addPlayersToMatch,
  removePlayerFromMatch,
  logReminder,
};
