const StaffAttendance = require('../models/staff_attendance.model');
const Staff = require('../models/staff.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');

// super_admin has no academyId of their own — they must pass one explicitly
// (query for reads); every other role is locked to theirs.
function resolveAcademyId(req, paramAcademyId) {
  if (req.user.role === 'super_admin') return paramAcademyId;
  return req.user.academyId?.toString();
}

function hasAccess(req, recordAcademyId) {
  if (req.user.role === 'super_admin') return true;
  if (!recordAcademyId) return false;
  return recordAcademyId.toString() === req.user.academyId?.toString();
}

// تطبيع كود الموظف القادم من الـ QR: يقبل 'STAFF:E-0001' أو 'E-0001'.
const normalizeStaffCode = (raw) => {
  if (!raw) return '';
  return String(raw).trim().replace(/^STAFF:/i, '').trim();
};

const pad2 = (n) => String(n).padStart(2, '0');
const serverDateStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const serverTimeStr = () => {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// "HH:mm" → دقائق منذ منتصف الليل
const toMinutes = (t) => {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const staffSummary = (s) => ({
  id: s._id.toString(),
  fullName: s.fullName,
  staffCode: s.staffCode,
  position: s.position,
  photo_url: s.photo_url,
});

// ─── POST /staff-attendance/scan ─────────────────────────────────────────────
// مسح QR الموظف: أول مسح = تسجيل حضور، ثاني مسح = تسجيل انصراف (اليوم مكتمل)،
// ثالث مسح = رسالة "اكتمل اليوم" دون إنشاء سجل جديد.
const scanAttendance = async (req, res, next) => {
  const { code, staffId, localDate, localTime } = req.body;
  logger.info(`[STAFF-ATT] scan: code="${code ?? ''}" staffId="${staffId ?? ''}"`);

  // 1) العثور على الموظف (بالكود من الـ QR أو بالمعرّف)
  let staff;
  if (staffId) {
    staff = await Staff.findById(staffId);
  } else {
    const normalized = normalizeStaffCode(code);
    if (!normalized) return next(new AppError('كود الموظف مطلوب', 400));
    staff = await Staff.findOne({ staffCode: normalized });
  }

  if (!staff || staff.isActive === false) {
    return next(new AppError('الموظف غير موجود', 404));
  }
  if (!hasAccess(req, staff.academyId)) {
    return next(new AppError('ليس لديك صلاحية لتسجيل حضور هذا الموظف', 403));
  }

  const date = (localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate)) ? localDate : serverDateStr();
  const time = (localTime && /^\d{2}:\d{2}$/.test(localTime)) ? localTime : serverTimeStr();

  const existing = await StaffAttendance.findOne({ staffId: staff._id, date });

  // ── الحالة الأولى: لا يوجد سجل لهذا اليوم → تسجيل حضور ────────────────────
  if (!existing) {
    const shiftStart = toMinutes(staff.shiftStartTime);
    const late = shiftStart !== null && toMinutes(time) > shiftStart;
    try {
      const record = await StaffAttendance.create({
        staffId: staff._id,
        academyId: staff.academyId,
        date,
        status: 'present',
        checkInTime: time,
        checkInTimestamp: new Date(),
        late,
        markedBy: req.user._id,
      });
      logActivity(req, {
        actionType: 'STAFF_CHECK_IN', entityType: 'STAFF_ATTENDANCE',
        entityId: record._id, entityName: staff.fullName, academyId: staff.academyId,
      });
      return sendSuccess(res, {
        data: { action: 'checkIn', late, staff: staffSummary(staff), attendance: record },
        message: late ? 'تم تسجيل الحضور (متأخر)' : 'تم تسجيل الحضور بنجاح',
        statusCode: 201,
      });
    } catch (err) {
      // سباق طلبات نادر — اطلب إعادة المسح
      if (err && err.code === 11000) {
        return next(new AppError('يرجى إعادة المسح', 409));
      }
      return next(err);
    }
  }

  // ── الحالة الثانية: يوجد حضور بدون انصراف → تسجيل انصراف ──────────────────
  if (!existing.checkOutTime) {
    existing.checkOutTime = time;
    await existing.save();
    logActivity(req, {
      actionType: 'STAFF_CHECK_OUT', entityType: 'STAFF_ATTENDANCE',
      entityId: existing._id, entityName: staff.fullName, academyId: staff.academyId,
    });
    return sendSuccess(res, {
      data: { action: 'checkOut', staff: staffSummary(staff), attendance: existing },
      message: 'تم تسجيل الانصراف — اكتمل اليوم',
    });
  }

  // ── الحالة الثالثة: اليوم مكتمل بالفعل → لا سجل جديد ──────────────────────
  return sendSuccess(res, {
    data: { action: 'complete', staff: staffSummary(staff), attendance: existing },
    message: 'اكتمل تسجيل حضور وانصراف هذا الموظف اليوم',
  });
};

// ─── POST /staff-attendance ──────────────────────────────────────────────────
// تسجيل يدوي لحضور/غياب (يُستخدم لنظام الرواتب). يبقى بجانب المسح بالـ QR.
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
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
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

  if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
    filter.date = req.query.date;
  } else if (req.query.startDate || req.query.endDate) {
    filter.date = {};
    if (req.query.startDate) filter.date.$gte = req.query.startDate;
    if (req.query.endDate) filter.date.$lte = req.query.endDate;
  }

  let records = await StaffAttendance.find(filter)
    .populate('staffId', 'fullName staffCode position photo_url')
    .sort({ date: -1, checkInTimestamp: -1 })
    .limit(500);

  // فلترة بالوظيفة بعد الـ populate (خاصية على الموظف)
  if (req.query.position && req.query.position.trim().length > 0) {
    const pos = req.query.position.trim();
    records = records.filter((r) => r.staffId && r.staffId.position === pos);
  }

  return sendSuccess(res, { data: records, message: 'تم جلب سجل الحضور بنجاح' });
};

// ─── GET /staff-attendance/report ────────────────────────────────────────────
// تقرير شامل: حضور/غياب/تأخير/إجمالي دقائق العمل لكل موظف خلال الفترة.
const getAttendanceReport = async (req, res, next) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return next(new AppError('تاريخ البداية والنهاية مطلوبان', 400));
  }

  const academyId = resolveAcademyId(req, req.query.academyId);
  if (req.user.role !== 'super_admin' && !academyId) {
    return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  }

  const matchFilter = { date: { $gte: startDate, $lte: endDate } };
  if (academyId) matchFilter.academyId = academyId;

  const records = await StaffAttendance.find(matchFilter).lean();

  const staffFilter = { isActive: true };
  if (academyId) staffFilter.academyId = academyId;
  if (req.query.position && req.query.position.trim().length > 0) {
    staffFilter.position = req.query.position.trim();
  }
  const staffList = await Staff.find(staffFilter).select('fullName staffCode position');

  // تجميع في الذاكرة لكل موظف
  const byStaff = {};
  for (const r of records) {
    const sid = r.staffId.toString();
    if (!byStaff[sid]) byStaff[sid] = { present: 0, absent: 0, late: 0, workMinutes: 0 };
    const b = byStaff[sid];
    if (r.status === 'present') b.present += 1;
    if (r.status === 'absent') b.absent += 1;
    if (r.late) b.late += 1;
    if (r.checkInTime && r.checkOutTime) {
      const [ih, im] = r.checkInTime.split(':').map(Number);
      const [oh, om] = r.checkOutTime.split(':').map(Number);
      let diff = oh * 60 + om - (ih * 60 + im);
      if (diff < 0) diff += 24 * 60;
      b.workMinutes += diff;
    }
  }

  const report = staffList.map((s) => {
    const b = byStaff[s._id.toString()] || { present: 0, absent: 0, late: 0, workMinutes: 0 };
    return {
      staffId: s._id.toString(),
      staffCode: s.staffCode,
      fullName: s.fullName,
      position: s.position,
      presentCount: b.present,
      absentCount: b.absent,
      lateCount: b.late,
      workMinutes: b.workMinutes,
      workHours: Math.round((b.workMinutes / 60) * 10) / 10,
    };
  });

  return sendSuccess(res, { data: report, message: 'تم جلب تقرير الحضور بنجاح' });
};

module.exports = {
  scanAttendance,
  markAttendance,
  getAttendanceHistory,
  getAttendanceReport,
};
