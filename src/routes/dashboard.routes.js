const express = require('express');
const router = express.Router();

const { protect, restrictTo } = require('../middleware/auth.middleware');
const {
  getDashboardStats,
  getStaffStats,
  getRevenueByMonth,
  getSubscriptionsByType,
  getPlayersByBirthYear,
  getEvaluationDistribution,
  getRecentActivities,
  getSportStats,
  getFinancialSummary,
  getFinancialMonthly,
} = require('../controllers/dashboard.controller');

router.use(protect);
router.use(restrictTo('super_admin', 'academy_admin'));

router.get('/stats', getDashboardStats);
router.get('/staff-stats', getStaffStats);
router.get('/revenue-by-month', getRevenueByMonth);
router.get('/subscriptions-by-type', getSubscriptionsByType);
router.get('/players-by-birth-year', getPlayersByBirthYear);
router.get('/evaluation-distribution', getEvaluationDistribution);
router.get('/recent-activities', getRecentActivities);
router.get('/sport-stats', getSportStats);

// Financial summary/monthly are super_admin-only global endpoints.
router.get('/financial-summary', restrictTo('super_admin'), getFinancialSummary);
router.get('/financial-monthly', restrictTo('super_admin'), getFinancialMonthly);

module.exports = router;
