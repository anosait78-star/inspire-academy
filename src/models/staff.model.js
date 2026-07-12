const mongoose = require('mongoose');

const WEEKDAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

const staffSchema = new mongoose.Schema(
  {
    // Employees are a global, Super-Admin-level resource — not tied to a specific academy.
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: false,
      default: null,
    },
    // كود الموظف الفريد (مثل E-0001) — أساس رمز الـ QR وثابت مدى الحياة.
    // يُولَّد تلقائياً في pre-validate بنفس فكرة كود اللاعب.
    staffCode: {
      type: String,
      unique: true,
      sparse: true,
      immutable: true,
    },
    fullName: {
      type: String,
      required: [true, 'اسم الموظف مطلوب'],
      trim: true,
      minlength: [2, 'الاسم يجب أن يكون حرفين على الأقل'],
      maxlength: [150, 'الاسم لا يمكن أن يتجاوز 150 حرف'],
    },
    position: {
      type: String,
      required: [true, 'الوظيفة مطلوبة'],
      trim: true,
      maxlength: [100, 'الوظيفة لا يمكن أن تتجاوز 100 حرف'],
    },
    phone: {
      type: String,
      required: [true, 'رقم الهاتف مطلوب'],
      trim: true,
      match: [/^[0-9+\-\s()]{7,20}$/, 'رقم الهاتف غير صحيح'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      validate: {
        validator: function (v) {
          if (v === undefined || v === null || v === '') return true;
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: 'البريد الإلكتروني غير صحيح',
      },
    },
    photo_url: {
      type: String,
      default: null,
    },
    photo_public_id: {
      type: String,
      default: null,
      select: false,
    },
    hireDate: {
      type: Date,
      required: [true, 'تاريخ التعيين مطلوب'],
    },
    // وقت بدء الدوام المتوقّع بصيغة 'HH:mm'. يُستخدم لتحديد التأخير عند مسح الـ QR.
    // إن كان فارغاً (null) لا يُحتسب الموظف متأخراً أبداً.
    shiftStartTime: {
      type: String,
      default: null,
      validate: {
        validator: function (v) {
          if (v === undefined || v === null || v === '') return true;
          return /^\d{2}:\d{2}$/.test(v);
        },
        message: 'صيغة وقت بدء الدوام غير صحيحة',
      },
    },
    baseSalary: {
      type: Number,
      default: null,
      min: [0, 'الراتب الأساسي لا يمكن أن يكون سالباً'],
    },
    workingDays: {
      type: [String],
      default: [],
      validate: {
        validator: function (arr) {
          return Array.isArray(arr) && arr.length > 0 && arr.every((d) => WEEKDAYS.includes(d));
        },
        message: 'أيام العمل غير صحيحة',
      },
    },
    monthlyAttendanceTarget: {
      type: Number,
      required: [true, 'عدد أيام الحضور المطلوبة مطلوب'],
      min: [1, 'عدد أيام الحضور المطلوبة يجب أن يكون 1 على الأقل'],
    },
    deductionType: {
      type: String,
      required: [true, 'نوع الخصم مطلوب'],
      enum: {
        values: ['percentage', 'fixed'],
        message: 'نوع الخصم غير صحيح',
      },
    },
    deductionValue: {
      type: Number,
      required: [true, 'قيمة الخصم مطلوبة'],
      min: [0, 'قيمة الخصم لا يمكن أن تكون سالبة'],
      validate: {
        validator: function (v) {
          if (this.deductionType === 'percentage') return v <= 100;
          return true;
        },
        message: 'نسبة الخصم لا يمكن أن تتجاوز 100%',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyId = ret.academyId?.toString();
        delete ret.__v;
        delete ret.photo_public_id;
        return ret;
      },
    },
  }
);

staffSchema.index({ academyId: 1 });
staffSchema.index({ academyId: 1, isActive: 1 });
staffSchema.index(
  { fullName: 'text', staffCode: 'text', phone: 'text' },
  { name: 'staff_text_search' }
);

staffSchema.statics.WEEKDAYS = WEEKDAYS;

// توليد كود الموظف التالي بصيغة E-0001 (بنفس فكرة generatePlayerCode للاعبين).
staffSchema.statics.generateStaffCode = async function () {
  const last = await this.findOne({ staffCode: { $ne: null } }, { staffCode: 1 })
    .sort({ staffCode: -1 });
  if (!last || !last.staffCode) return 'E-0001';
  const lastNum = parseInt(last.staffCode.split('-')[1], 10);
  return 'E-' + String(lastNum + 1).padStart(4, '0');
};

// تعيين كود الموظف تلقائياً عند الإنشاء.
staffSchema.pre('validate', async function (next) {
  if (this.isNew && !this.staffCode) {
    this.staffCode = await this.constructor.generateStaffCode();
  }
  next();
});

const Staff = mongoose.model('Staff', staffSchema);
module.exports = Staff;
