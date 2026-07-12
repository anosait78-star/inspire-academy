const mongoose = require('mongoose');

// سجل حضور/غياب الموظف. على عكس حضور اللاعبين، نُسجّل الغياب صراحةً
// لأن حساب الراتب يحتاج عدد غياب موثوق لكل شهر.
const staffAttendanceSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: [true, 'معرّف الموظف مطلوب'],
    },
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    date: {
      type: String,
      required: [true, 'تاريخ الحضور مطلوب'],
      match: [/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة'],
    },
    status: {
      type: String,
      required: [true, 'حالة الحضور مطلوبة'],
      enum: {
        values: ['present', 'absent'],
        message: 'حالة الحضور غير صحيحة',
      },
    },
    // وقت الحضور (أول مسح) بصيغة 'HH:mm'.
    checkInTime: {
      type: String,
      default: null,
      match: [/^\d{2}:\d{2}$/, 'صيغة وقت الحضور غير صحيحة'],
    },
    // وقت الانصراف (ثاني مسح) بصيغة 'HH:mm'.
    checkOutTime: {
      type: String,
      default: null,
      match: [/^\d{2}:\d{2}$/, 'صيغة وقت الانصراف غير صحيحة'],
    },
    // طابع زمني دقيق لوقت الحضور — للترتيب والحسابات.
    checkInTimestamp: {
      type: Date,
      default: null,
    },
    // هل تأخّر الموظف عن وقت بدء دوامه المتوقّع؟
    late: {
      type: Boolean,
      default: false,
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    notes: {
      type: String,
      maxlength: [300, 'الملاحظات لا يمكن أن تتجاوز 300 حرف'],
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        if (ret.staffId && ret.staffId._id) {
          ret.staffId._id = ret.staffId._id.toString();
        } else if (ret.staffId) {
          ret.staffId = ret.staffId.toString();
        }
        ret.academyId = ret.academyId?.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

// مدة العمل بالدقائق (تُحسب من وقت الحضور والانصراف). null إن لم يكتمل اليوم.
staffAttendanceSchema.virtual('workMinutes').get(function () {
  if (!this.checkInTime || !this.checkOutTime) return null;
  const [ih, im] = this.checkInTime.split(':').map(Number);
  const [oh, om] = this.checkOutTime.split(':').map(Number);
  let diff = oh * 60 + om - (ih * 60 + im);
  if (diff < 0) diff += 24 * 60; // انصراف بعد منتصف الليل
  return diff;
});

staffAttendanceSchema.index({ staffId: 1, date: 1 }, { unique: true });
staffAttendanceSchema.index({ academyId: 1, date: 1 });

const StaffAttendance = mongoose.model('StaffAttendance', staffAttendanceSchema);
module.exports = StaffAttendance;
