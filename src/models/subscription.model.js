const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: [true, 'معرّف اللاعب مطلوب'],
    },
    type: {
      type: String,
      enum: {
        values: ['NEW_SUBSCRIPTION', 'RENEWAL'],
        message: 'نوع الاشتراك يجب أن يكون NEW_SUBSCRIPTION أو RENEWAL',
      },
      required: [true, 'نوع الاشتراك مطلوب'],
    },
    amount: {
      type: Number,
      required: [true, 'مبلغ الاشتراك مطلوب'],
      min: [0, 'مبلغ الاشتراك لا يمكن أن يكون سالباً'],
    },
    startDate: {
      type: Date,
      required: [true, 'تاريخ بداية الاشتراك مطلوب'],
    },
    endDate: {
      type: Date,
      required: [true, 'تاريخ نهاية الاشتراك مطلوب'],
      validate: {
        validator: function (value) {
          return value > this.startDate;
        },
        message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية',
      },
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'الملاحظات لا يمكن أن تتجاوز 500 حرف'],
    },

    // ─── Freeze / Resume ────────────────────────────────────────────────────
    // status is the authoritative, explicitly-set field. "expired" is derived
    // at read time (see toJSON transform below) rather than stored, so a
    // subscription that simply runs past its endDate doesn't need a cron job
    // to flip it — but freeze/resume/cancel always set this explicitly.
    status: {
      type: String,
      enum: ['active', 'frozen', 'expired', 'cancelled'],
      default: 'active',
    },
    isFrozen: {
      type: Boolean,
      default: false,
    },
    freezeDate: {
      type: Date,
      default: null,
    },
    resumeDate: {
      type: Date,
      default: null,
    },
    // Days of the subscription period already consumed as of freezeDate.
    usedDays: {
      type: Number,
      default: null,
    },
    // Days left (banked) at the moment of freezing — re-applied on resume.
    remainingDays: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyId = ret.academyId?.toString();

        // إذا كان playerId مُحمَّلاً (populated object) نحتفظ به كـ object
        // ونحوّل فقط الـ _id الداخلي إلى string
        // إذا كان ObjectId عادياً نحوّله إلى string
        if (ret.playerId && typeof ret.playerId === 'object' && ret.playerId._id !== undefined) {
          // populated — stringify the nested _id only
          ret.playerId._id = ret.playerId._id?.toString();
        } else if (ret.playerId) {
          ret.playerId = ret.playerId.toString();
        }

        // Derive "expired" at read time — the stored field stays 'active' so
        // resume/freeze logic always sees the real state, not a stale label.
        if (ret.status === 'active' && new Date() > new Date(ret.endDate)) {
          ret.status = 'expired';
        }

        delete ret.__v;
        return ret;
      },
    },
  }
);

// Virtuals
subscriptionSchema.virtual('isActive').get(function () {
  return this.status === 'active' && new Date() <= this.endDate;
});

// Indexes
subscriptionSchema.index({ playerId: 1 });
subscriptionSchema.index({ academyId: 1 });
subscriptionSchema.index({ academyId: 1, playerId: 1 });
subscriptionSchema.index({ endDate: 1 });
subscriptionSchema.index({ type: 1 });

const Subscription = mongoose.model('Subscription', subscriptionSchema);
module.exports = Subscription;
