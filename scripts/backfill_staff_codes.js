// تعبئة كود الموظف (staffCode) للموظفين القدامى الذين أُنشئوا قبل إضافة الحقل.
// شغّل مرة واحدة: node scripts/backfill_staff_codes.js
require('dotenv').config();
const mongoose = require('mongoose');
const Staff = require('../src/models/staff.model');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'inspire_academy' });
  console.log('✅ MongoDB connected');

  // نعالج الموظفين الأقدم أولاً حتى تُخصَّص الأكواد بترتيب منطقي.
  const staffWithout = await Staff.find({
    $or: [{ staffCode: { $exists: false } }, { staffCode: null }],
  }).sort({ created_at: 1 });

  console.log(`عدد الموظفين بدون كود: ${staffWithout.length}`);

  for (const s of staffWithout) {
    s.staffCode = await Staff.generateStaffCode();
    await s.save();
    console.log(`  ${s.fullName} → ${s.staffCode}`);
  }

  console.log('✅ اكتملت التعبئة');
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('❌ فشلت التعبئة:', err);
  process.exit(1);
});
