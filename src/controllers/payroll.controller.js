const Payroll = require('../models/payroll.model');
const Staff = require('../models/staff.model');
const StaffAttendance = require('../models/staff_attendance.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

// Payroll is scoped by academy: super_admin sees all (optionally narrowed by an
// academyId param); academy_admin is pinned to their own academy's staff.
// Payroll records reference staff by staffId only (no academyId field), so we
// derive the allowed staff ids from the Staff collection when scoping.

// يُعيد فلتر staffId لتقييد سجلات الرواتب بموظفي أكاديمية المستخدم.
// للـ super_admin: null (بلا تقييد) ما لم يمرّر academyId. لغيره: مقيّد بأكاديميته.
async function buildStaffScope(req) {
  let academyId = null;
  if (req.user.role === 'super_admin') {
    academyId = req.query.academyId || req.body.academyId || null;
  } else {
    academyId = req.user.academyId?.toString();
  }
  if (!academyId) return { academyId: null, staffIdIn: null };
  const staffIds = await Staff.find({ academyId }).distinct('_id');
  return { academyId, staffIdIn: staffIds };
}

const computeNetSalary = ({ baseSalary, monthlyAttendanceTarget, presentCount, deductionType, deductionValue }) => {
  const absentCount = Math.max(monthlyAttendanceTarget - presentCount, 0);
  const salary = baseSalary || 0;
  let deductionAmount;
  if (deductionType === 'percentage') {
    deductionAmount = salary * (deductionValue / 100) * absentCount;
  } else {
    deductionAmount = deductionValue * absentCount;
  }
  deductionAmount = Math.min(deductionAmount, salary);
  const netSalary = salary - deductionAmount;
  return { absentCount, deductionAmount, netSalary };
};

// ─── POST /payroll/generate ──────────────────────────────────────────────────
const generatePayroll = async (req, res, next) => {
  const { month, staffId, force } = req.body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return next(new AppError('الشهر مطلوب بصيغة YYYY-MM', 400));
  }

  const staffFilter = { isActive: true };
  if (staffId) staffFilter._id = staffId;
  // تقييد بأكاديمية المستخدم (academy_admin) أو academyId المُمرَّر (super_admin).
  const { academyId: scopeAcademyId } = await buildStaffScope(req);
  if (scopeAcademyId) staffFilter.academyId = scopeAcademyId;

  const staffList = await Staff.find(staffFilter);
  if (staffList.length === 0) {
    return next(new AppError('لا يوجد موظفون لتوليد الرواتب لهم', 404));
  }

  const startDate = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  const results = [];
  for (const staff of staffList) {
    const existing = await Payroll.findOne({ staffId: staff._id, month });
    if (existing && existing.status === 'paid' && !force) {
      results.push(existing);
      continue;
    }

    const presentCount = await StaffAttendance.countDocuments({
      staffId: staff._id,
      status: 'present',
      date: { $gte: startDate, $lte: endDate },
    });

    const { absentCount, deductionAmount, netSalary } = computeNetSalary({
      baseSalary: staff.baseSalary,
      monthlyAttendanceTarget: staff.monthlyAttendanceTarget,
      presentCount,
      deductionType: staff.deductionType,
      deductionValue: staff.deductionValue,
    });

    const payrollDoc = await Payroll.findOneAndUpdate(
      { staffId: staff._id, month },
      {
        staffId: staff._id,
        month,
        baseSalary: staff.baseSalary || 0,
        monthlyAttendanceTarget: staff.monthlyAttendanceTarget,
        presentCount,
        absentCount,
        deductionType: staff.deductionType,
        deductionValue: staff.deductionValue,
        deductionAmount,
        netSalary,
        generatedAt: new Date(),
      },
      { upsert: true, new: true, runValidators: true }
    );

    logActivity(req, {
      actionType: 'GENERATE_PAYROLL', entityType: 'PAYROLL',
      entityId: payrollDoc._id, entityName: staff.fullName, academyId: staff.academyId,
    });
    results.push(payrollDoc);
  }

  return sendSuccess(res, { data: results, message: 'تم توليد الرواتب بنجاح' });
};

// ─── GET /payroll ────────────────────────────────────────────────────────────
const getPayrollList = async (req, res, next) => {
  const filter = {};
  if (req.query.month) filter.month = req.query.month;
  if (req.query.status) filter.status = req.query.status;

  // تقييد بالأكاديمية عبر موظفيها. عند طلب موظف محدّد نتحقق أنه ضمن النطاق.
  const { staffIdIn } = await buildStaffScope(req);
  const requestedStaffId = req.query.staffId;
  if (staffIdIn) {
    const allowed = new Set(staffIdIn.map((id) => id.toString()));
    if (requestedStaffId) {
      if (!allowed.has(requestedStaffId.toString())) {
        return sendSuccess(res, { data: [], message: 'تم جلب الرواتب بنجاح' });
      }
      filter.staffId = requestedStaffId;
    } else {
      filter.staffId = { $in: staffIdIn };
    }
  } else if (requestedStaffId) {
    filter.staffId = requestedStaffId;
  }

  const records = await Payroll.find(filter).populate('staffId', 'fullName position').sort({ month: -1 });
  return sendSuccess(res, { data: records, message: 'تم جلب الرواتب بنجاح' });
};

// ─── GET /payroll/report ─────────────────────────────────────────────────────
const getPayrollReport = async (req, res, next) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return next(new AppError('الشهر مطلوب بصيغة YYYY-MM', 400));
  }

  const reportFilter = { month };

  // تقييد التقرير بموظفي أكاديمية المستخدم.
  const { staffIdIn } = await buildStaffScope(req);
  if (staffIdIn) reportFilter.staffId = { $in: staffIdIn };

  const records = await Payroll.find(reportFilter)
    .populate('staffId', 'fullName position');

  const report = records.map((r) => ({
    staffId: r.staffId?._id?.toString(),
    fullName: r.staffId?.fullName,
    position: r.staffId?.position,
    baseSalary: r.baseSalary,
    deductionAmount: r.deductionAmount,
    netSalary: r.netSalary,
    status: r.status,
  }));

  const totals = report.reduce(
    (acc, r) => ({
      totalBaseSalary: acc.totalBaseSalary + r.baseSalary,
      totalDeductions: acc.totalDeductions + r.deductionAmount,
      totalNetSalary: acc.totalNetSalary + r.netSalary,
    }),
    { totalBaseSalary: 0, totalDeductions: 0, totalNetSalary: 0 }
  );

  return sendSuccess(res, { data: { report, totals }, message: 'تم جلب تقرير الرواتب بنجاح' });
};

// ─── PATCH /payroll/:id/mark-paid ────────────────────────────────────────────
const markPaid = async (req, res, next) => {
  const payroll = await Payroll.findById(req.params.id).populate('staffId', 'academyId');
  if (!payroll) return next(new AppError('سجل الراتب غير موجود', 404));

  // منع مدير الأكاديمية من تأكيد دفع راتب موظف خارج أكاديميته.
  if (req.user.role !== 'super_admin') {
    const recAcademyId = payroll.staffId?.academyId?.toString();
    if (recAcademyId !== req.user.academyId?.toString()) {
      return next(new AppError('ليس لديك صلاحية لتعديل هذا السجل', 403));
    }
  }

  payroll.status = 'paid';
  payroll.paidAt = new Date();
  await payroll.save();

  logActivity(req, {
    actionType: 'MARK_PAYROLL_PAID', entityType: 'PAYROLL',
    entityId: payroll._id, entityName: payroll.month, academyId: payroll.academyId,
  });
  return sendSuccess(res, { data: payroll, message: 'تم تأكيد دفع الراتب بنجاح' });
};

module.exports = { generatePayroll, getPayrollList, getPayrollReport, markPaid };
