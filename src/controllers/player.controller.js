const Player = require('../models/player.model');
const Academy = require('../models/academy.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');
const { isGlobalScopeRole } = require('../utils/permissions');

// Normalize an array field coming from multipart/form-data.
// Accepts: a real array, a JSON-encoded array string, or a comma-separated string.
const parseArrayField = (raw) => {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
    } catch (_) {
      // not JSON — fall through to comma-split
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
};

// ─── GET /players ───────────────────────────────────────────────────────────
const getPlayers = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  // Build base filter
  const filter = {};

  // Active filter (super_admin can request inactive players)
  if (req.query.showInactive === 'true' && req.user.role === 'super_admin') {
    // no isActive filter — show all
  } else {
    filter.isActive = true;
  }

  // Academy scope — كل مستخدم غير super_admin مُقيَّد حتمياً بأكاديميته.
  // super_admin فقط يمرّر academyId صراحةً. (يشمل دور admin + academy_admin.)
  // إن لم يمرّر super_admin أي academyId → لا فلتر (نتائج كل الأكاديميات).
  if (isGlobalScopeRole(req.user.role)) {
    if (req.query.academyId) {
      filter.academyId = req.query.academyId;
    }
  } else {
    filter.academyId = req.user.academyId;
  }

  // Birth year filter
  if (req.query.birthYear) {
    const year = parseInt(req.query.birthYear, 10);
    if (!isNaN(year)) {
      filter.birthDate = {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${year + 1}-01-01`),
      };
    }
  }

  // Sport filter (multi-sport academies)
  if (req.query.sport && req.query.sport.trim().length > 0) {
    filter.sport = req.query.sport.trim();
  }

  // Attendance-day filter — matches players whose attendanceDays array contains the day
  if (req.query.attendanceDay && req.query.attendanceDay.trim().length > 0) {
    filter.attendanceDays = req.query.attendanceDay.trim();
  }

  // Search
  if (req.query.search && req.query.search.trim().length > 0) {
    const searchTerm = req.query.search.trim();
    try {
      // Try text index first
      filter.$text = { $search: searchTerm };
    } catch (e) {
      // Fallback to regex search
      const regex = new RegExp(searchTerm, 'i');
      filter.$or = [
        { fullName: regex },
        { playerCode: regex },
        { parentPhone: regex },
      ];
    }
  }

  const [players, total] = await Promise.all([
    Player.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
    Player.countDocuments(filter),
  ]);

  return sendPaginated(res, {
    data: players,
    total,
    page,
    limit,
    message: 'تم جلب اللاعبين بنجاح',
  });
};

// ─── GET /players/search ─────────────────────────────────────────────────────
const searchPlayers = async (req, res, next) => {
  const q = req.query.q ? req.query.q.trim() : '';
  if (q.length < 2) {
    return next(new AppError('يجب أن يكون نص البحث حرفين على الأقل', 400));
  }

  const regex = new RegExp(q, 'i');
  const filter = {
    isActive: true,
    $or: [
      { fullName: regex },
      { playerCode: regex },
      { parentPhone: regex },
    ],
  };

  if (isGlobalScopeRole(req.user.role)) {
    if (req.query.academyId) {
      filter.academyId = req.query.academyId;
    }
  } else {
    filter.academyId = req.user.academyId;
  }

  const players = await Player.find(filter).sort({ created_at: -1 }).limit(50);

  return sendSuccess(res, { data: players, message: 'تم البحث بنجاح' });
};

// ─── GET /players/:id ────────────────────────────────────────────────────────
const getPlayerById = async (req, res, next) => {
  const player = await Player.findById(req.params.id);
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  if (!isGlobalScopeRole(req.user.role) &&
      player.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى هذا اللاعب', 403));
  }

  return sendSuccess(res, { data: player, message: 'تم جلب بيانات اللاعب بنجاح' });
};

// ─── POST /players ───────────────────────────────────────────────────────────
const createPlayer = async (req, res, next) => {
  // Determine academyId — super_admin يحدّدها، غيره مُقيَّد بأكاديميته.
  let academyId;
  if (isGlobalScopeRole(req.user.role)) {
    academyId = req.body.academyId;
    if (!academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  } else {
    academyId = req.user.academyId;
  }

  const {
    fullName,
    birthDate,
    parentName,
    parentRelationship,
    parentJob,
    parentPhone,
    parentEmail,
    playerPhone,
    notes,
    sport,
  } = req.body;

  const playerData = {
    academyId,
    fullName,
    birthDate,
    parentName,
    parentRelationship,
    parentPhone,
  };

  if (parentJob !== undefined) playerData.parentJob = parentJob;
  if (parentEmail !== undefined) playerData.parentEmail = parentEmail;
  if (playerPhone !== undefined) playerData.playerPhone = playerPhone;
  if (notes !== undefined) playerData.notes = notes;

  // ── Sport assignment ──────────────────────────────────────────────────────
  // Single-sport academy → assign its only sport automatically.
  // Multi-sport academy   → `sport` is required and must be one of academy.sports.
  const academy = await Academy.findById(academyId).select('sports');
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));
  const academySports = Array.isArray(academy.sports) && academy.sports.length > 0
    ? academy.sports
    : ['كرة سلة'];

  if (academySports.length === 1) {
    playerData.sport = academySports[0];
  } else {
    const chosen = sport ? String(sport).trim() : '';
    if (!chosen) return next(new AppError('الرياضة مطلوبة', 422));
    if (!academySports.includes(chosen)) {
      return next(new AppError('الرياضة المختارة غير متاحة في هذه الأكاديمية', 422));
    }
    playerData.sport = chosen;
  }

  // ── Attendance days ───────────────────────────────────────────────────────
  const attendanceDays = parseArrayField(req.body.attendanceDays);
  if (attendanceDays !== undefined) playerData.attendanceDays = attendanceDays;

  if (req.file) {
    playerData.image_url = req.file.path;
    playerData.image_public_id = req.file.filename;
  }

  const player = await Player.create(playerData);

  logger.info(`Player created: ${player.playerCode} - ${player.fullName}`);
  logActivity(req, {
    actionType: 'CREATE_PLAYER', entityType: 'PLAYER',
    entityId: player._id, entityName: player.fullName, academyId: player.academyId,
  });
  return sendSuccess(res, { data: player, message: 'تم إضافة اللاعب بنجاح', statusCode: 201 });
};

// ─── PUT /players/:id ────────────────────────────────────────────────────────
const updatePlayer = async (req, res, next) => {
  const player = await Player.findById(req.params.id).select('+image_public_id');
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  if (!isGlobalScopeRole(req.user.role) &&
      player.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذا اللاعب', 403));
  }

  // Allowed updatable fields (playerCode is NOT updatable)
  const allowedFields = ['fullName', 'birthDate', 'parentName', 'parentRelationship', 'parentJob', 'parentPhone', 'parentEmail', 'playerPhone', 'notes'];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      player[field] = req.body[field];
    }
  }

  // Sport update — validate against the academy's sports list when provided.
  if (req.body.sport !== undefined) {
    const chosen = String(req.body.sport).trim();
    const academy = await Academy.findById(player.academyId).select('sports');
    const academySports = academy && Array.isArray(academy.sports) && academy.sports.length > 0
      ? academy.sports
      : ['كرة سلة'];
    if (chosen && !academySports.includes(chosen)) {
      return next(new AppError('الرياضة المختارة غير متاحة في هذه الأكاديمية', 422));
    }
    if (chosen) player.sport = chosen;
  }

  // Attendance days update
  const attendanceDays = parseArrayField(req.body.attendanceDays);
  if (attendanceDays !== undefined) player.attendanceDays = attendanceDays;

  // Handle image replacement
  if (req.file) {
    if (player.image_public_id) {
      await deleteImage(player.image_public_id).catch(() => {});
    }
    player.image_url = req.file.path;
    player.image_public_id = req.file.filename;
  }

  await player.save();

  logger.info(`Player updated: ${player.playerCode} - ${player.fullName}`);
  logActivity(req, {
    actionType: 'UPDATE_PLAYER', entityType: 'PLAYER',
    entityId: player._id, entityName: player.fullName, academyId: player.academyId,
  });
  return sendSuccess(res, { data: player, message: 'تم تحديث بيانات اللاعب بنجاح' });
};

// ─── DELETE /players/:id ─────────────────────────────────────────────────────
const deletePlayer = async (req, res, next) => {
  if (req.user.role === 'academy_supervisor') {
    return next(new AppError('ليس لديك صلاحية لحذف اللاعبين', 403));
  }

  const player = await Player.findById(req.params.id);
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  if (req.user.role !== 'super_admin' &&
      player.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لحذف هذا اللاعب', 403));
  }

  player.isActive = false;
  await player.save();

  logger.info(`Player deleted (soft): ${player.playerCode} - ${player.fullName}`);
  logActivity(req, {
    actionType: 'DELETE_PLAYER', entityType: 'PLAYER',
    entityId: player._id, entityName: player.fullName, academyId: player.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف اللاعب بنجاح' });
};

// ─── DELETE /players/:id/image ───────────────────────────────────────────────
const deletePlayerImage = async (req, res, next) => {
  if (req.user.role === 'academy_supervisor') {
    return next(new AppError('ليس لديك صلاحية لحذف صور اللاعبين', 403));
  }

  const player = await Player.findById(req.params.id).select('+image_public_id');
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  if (req.user.role !== 'super_admin' &&
      player.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لحذف صورة هذا اللاعب', 403));
  }

  if (!player.image_public_id) {
    return next(new AppError('لا توجد صورة لحذفها', 400));
  }

  await deleteImage(player.image_public_id);
  player.image_url = null;
  player.image_public_id = null;
  await player.save();

  return sendSuccess(res, { message: 'تم حذف صورة اللاعب بنجاح' });
};

module.exports = {
  getPlayers,
  searchPlayers,
  getPlayerById,
  createPlayer,
  updatePlayer,
  deletePlayer,
  deletePlayerImage,
};
