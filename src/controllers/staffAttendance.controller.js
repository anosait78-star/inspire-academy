const StaffAttendance = require('../models/staff_attendance.model');
const Staff = require('../models/staff.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

// super_admin has no academyId of their own — they must pass one explicitly
// (query for reads); every other role is locked to theirs.
function resolveAcademyId(req, paramAcademyId) {
  if (req.user.role === 'super_admin') return paramAcademyId;
  return req.user.academyId?.toString();
}

function hasAccess(req, recordAcademyId) {
  if (req.user.role === 'super_admin') return true;
  return recordAcademyId.toString() === req.user.academyId?.toString();
}

// ─── POST /staff-attendance ──────────────────────────────────────────────────
const markAttendance = async (req, res, next) => {
  const { staffId, date, status, notes } = req.body;

  const staff = await Staff.findById(staffId);
  if (!staff) return next(new AppError('الموظف غير موجود', 404));
  if (!hasAccess(req, staff.academyId)) {
    return next(new AppError('ليس لديك صلاحية لتسجيل حضور هذا الموظف', 403));
  }

  const record = await StaffAttendance.findOneAndUpdate(
    { staffId, date },
    {
      staffId,
      academyId: staff.academyId,
      date,
      status,
      markedBy: req.user._id,
      notes: notes !== undefined ? notes : null,
    },
    { upsert: true, new: true, runValidators: true }
  );

  logActivity(req, {
    actionType: 'MARK_STAFF_ATTENDANCE', entityType: 'STAFF_ATTENDANCE',
    entityId: record._id, entityName: staff.fullName, academyId: staff.academyId,
  });
  return sendSuccess(res, { data: record, message: 'تم تسجيل الحضور بنجاح' });
};

// ─── GET /staff-attendance ───────────────────────────────────────────────────
const getAttendanceHistory = async (req, res, next) => {
  const academyId = resolveAcademyId(req, req.query.academyId);
  if (req.user.role !== 'super_admin' && !academyId) {
    return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  }

  const filter = {};
  if (academyId) filter.academyId = academyId;

  if (req.query.staffId) filter.staffId = req.query.staffId;

  if (req.query.startDate || req.query.endDate) {
    filter.date = {};
    if (req.query.startDate) filter.date.$gte = req.query.startDate;
    if (req.query.endDate) filter.date.$lte = req.query.endDate;
  }

  const records = await StaffAttendance.find(filter).sort({ date: -1 }).limit(500);
  return sendSuccess(res, { data: records, message: 'تم جلب سجل الحضور بنجاح' });
};

// ─── GET /staff-attendance/report ────────────────────────────────────────────
const getAttendanceReport = async (req, res, next) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return next(new AppError('تاريخ البداية والنهاية مطلوبان', 400));
  }

  const academyId = resolveAcademyId(req, req.query.academyId);
  if (req.user.role !== 'super_admin' && !academyId) {
    return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  }

  const matchFilter = {
    date: { $gte: startDate, $lte: endDate },
  };
  if (academyId) matchFilter.academyId = academyId;

  const counts = await StaffAttendance.aggregate([
    { $match: matchFilter },
    { $group: { _id: { staffId: '$staffId', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const staffFilter = { isActive: true };
  if (academyId) staffFilter.academyId = academyId;
  const staffList = await Staff.find(staffFilter)
    .select('fullName position');

  const report = staffList.map((s) => {
    const present = counts.find((c) => c._id.staffId.toString() === s._id.toString() && c._id.status === 'present');
    const absent = counts.find((c) => c._id.staffId.toString() === s._id.toString() && c._id.status === 'absent');
    return {
      staffId: s._id.toString(),
      fullName: s.fullName,
      position: s.position,
      presentCount: present ? present.count : 0,
      absentCount: absent ? absent.count : 0,
    };
  });

  return sendSuccess(res, { data: report, message: 'تم جلب تقرير الحضور بنجاح' });
};

module.exports = { markAttendance, getAttendanceHistory, getAttendanceReport };
