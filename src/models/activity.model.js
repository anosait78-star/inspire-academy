const mongoose = require('mongoose');

// سجل النشاط: يحفظ كل عملية يقوم بها مستخدمو الأكاديمية مع اسم المستخدم.
const activitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
    },
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: true,
    },
    actionType: {
      type: String,
      required: true,
      enum: [
        'CREATE_PLAYER', 'UPDATE_PLAYER', 'DELETE_PLAYER',
        'ADD_SUBSCRIPTION', 'RENEW_SUBSCRIPTION', 'DELETE_SUBSCRIPTION',
        'ADD_EVALUATION', 'UPDATE_EVALUATION', 'DELETE_EVALUATION',
        'RECORD_ATTENDANCE',
        'ADD_USER', 'UPDATE_USER', 'DELETE_USER',
        'UPDATE_ACADEMY',
        'ADD_STAFF', 'UPDATE_STAFF', 'DELETE_STAFF',
        'MARK_STAFF_ATTENDANCE',
        'GENERATE_PAYROLL', 'MARK_PAYROLL_PAID',
        'ADD_EXPENSE', 'UPDATE_EXPENSE', 'DELETE_EXPENSE',
      ],
    },
    entityType: {
      type: String,
      required: true,
      enum: [
        'PLAYER', 'SUBSCRIPTION', 'EVALUATION', 'ATTENDANCE', 'USER', 'ACADEMY',
        'STAFF', 'STAFF_ATTENDANCE', 'PAYROLL', 'EXPENSE',
      ],
    },
    entityId: {
      type: String,
      default: null,
    },
    entityName: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.userId = ret.userId?.toString();
        ret.academyId = ret.academyId?.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

activitySchema.index({ academyId: 1, createdAt: -1 });

const Activity = mongoose.model('Activity', activitySchema);
module.exports = Activity;
