// Idempotent seed for the Inspire Academy SUPER_ADMIN accounts.
// Safe to run multiple times — existing accounts are updated in place, never duplicated.
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./src/config/database');

const SUPER_ADMINS = [
  { name: 'Super Admin', email: 'admin@inspireacademy.com', password: 'ChangeMe123!' },
];

const seedSuperAdmins = async () => {
  await connectDB();
  const User = require('./src/models/user.model');

  for (const { name, email, password } of SUPER_ADMINS) {
    const existing = await User.findOne({ email });

    if (existing) {
      existing.name = name;
      existing.password = password; // re-hashed by the pre('save') hook
      existing.role = 'super_admin';
      existing.isActive = true;
      await existing.save();
      console.log(`✅ Updated existing super_admin: ${email}`);
    } else {
      await User.create({
        name,
        email,
        password,
        role: 'super_admin',
        isActive: true,
      });
      console.log(`✅ Created super_admin: ${email}`);
    }
  }

  console.log('\n🎉 Super admin seeding completed (idempotent).');
  process.exit(0);
};

seedSuperAdmins().catch((err) => {
  console.error('❌ Seeding failed:', err.message);
  process.exit(1);
});
