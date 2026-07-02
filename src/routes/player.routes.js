const express = require('express');
const { body } = require('express-validator');
const {
  getPlayers,
  searchPlayers,
  getPlayerById,
  createPlayer,
  updatePlayer,
  deletePlayer,
  deletePlayerImage,
} = require('../controllers/player.controller');
const { protect } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');
const { uploadPlayerImage } = require('../config/cloudinary');

const router = express.Router();

// All routes require authentication
router.use(protect);

// ─── Validators ──────────────────────────────────────────────────────────────

const createValidators = [
  body('fullName')
    .notEmpty().withMessage('الاسم الكامل مطلوب')
    .isLength({ min: 2, max: 150 }).withMessage('الاسم يجب أن يكون بين 2 و 150 حرف'),
  body('birthDate')
    .notEmpty().withMessage('تاريخ الميلاد مطلوب')
    .isDate().withMessage('تاريخ الميلاد غير صحيح'),
  body('parentName')
    .notEmpty().withMessage('اسم ولي الأمر مطلوب')
    .isLength({ min: 2, max: 100 }).withMessage('اسم ولي الأمر يجب أن يكون بين 2 و 100 حرف'),
  body('parentRelationship')
    .notEmpty().withMessage('صلة القرابة مطلوبة')
    .isIn(['أب', 'أم', 'أخ', 'أخت', 'جد', 'جدة', 'عم', 'عمة', 'خال', 'خالة', 'وصي'])
    .withMessage('صلة القرابة غير صحيحة'),
  body('parentPhone')
    .notEmpty().withMessage('رقم هاتف ولي الأمر مطلوب')
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم الهاتف غير صحيح'),
  body('parentEmail')
    .optional({ checkFalsy: true })
    .isEmail().withMessage('البريد الإلكتروني لولي الأمر غير صحيح'),
  body('playerPhone')
    .optional({ checkFalsy: true })
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم هاتف اللاعب غير صحيح'),
  body('sport')
    .optional({ checkFalsy: true })
    .isLength({ max: 60 }).withMessage('اسم الرياضة غير صحيح'),
];

const updateValidators = [
  body('fullName')
    .optional()
    .isLength({ min: 2, max: 150 }).withMessage('الاسم يجب أن يكون بين 2 و 150 حرف'),
  body('birthDate')
    .optional()
    .isDate().withMessage('تاريخ الميلاد غير صحيح'),
  body('parentName')
    .optional()
    .isLength({ min: 2, max: 100 }).withMessage('اسم ولي الأمر يجب أن يكون بين 2 و 100 حرف'),
  body('parentRelationship')
    .optional()
    .isIn(['أب', 'أم', 'أخ', 'أخت', 'جد', 'جدة', 'عم', 'عمة', 'خال', 'خالة', 'وصي'])
    .withMessage('صلة القرابة غير صحيحة'),
  body('parentPhone')
    .optional()
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم الهاتف غير صحيح'),
  body('parentEmail')
    .optional({ checkFalsy: true })
    .isEmail().withMessage('البريد الإلكتروني لولي الأمر غير صحيح'),
  body('playerPhone')
    .optional({ checkFalsy: true })
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم هاتف اللاعب غير صحيح'),
  body('sport')
    .optional({ checkFalsy: true })
    .isLength({ max: 60 }).withMessage('اسم الرياضة غير صحيح'),
];

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET  /players
router.get('/', getPlayers);

// GET  /players/search?q=...   ← MUST be before /:id to avoid conflict
router.get('/search', searchPlayers);

// GET  /players/:id
router.get('/:id', getPlayerById);

// POST /players
router.post(
  '/',
  uploadPlayerImage.single('image'),
  createValidators,
  validate,
  createPlayer
);

// PUT  /players/:id
router.put(
  '/:id',
  uploadPlayerImage.single('image'),
  updateValidators,
  validate,
  updatePlayer
);

// DELETE /players/:id
router.delete('/:id', deletePlayer);

// DELETE /players/:id/image
router.delete('/:id/image', deletePlayerImage);

module.exports = router;
