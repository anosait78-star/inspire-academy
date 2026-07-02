const cloudinary = require('cloudinary').v2;
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('يُسمح فقط برفع ملفات الصور'), false);
  }
};

const memoryStorage = multer.memoryStorage();

const uploadBufferToCloudinary = (buffer, options) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
};

const createUploader = ({ fieldName, folder, allowedFormats, transformation, maxFileSize }) => {
  const multerUpload = multer({
    storage: memoryStorage,
    limits: { fileSize: maxFileSize },
    fileFilter,
  }).single(fieldName);

  const uploadToCloudinary = async (req, res, next) => {
    if (!req.file) return next();

    try {
      const result = await uploadBufferToCloudinary(req.file.buffer, {
        folder,
        allowed_formats: allowedFormats,
        transformation,
        resource_type: 'image',
      });

      req.file.path = result.secure_url;
      req.file.filename = result.public_id;

      next();
    } catch (error) {
      next(error);
    }
  };

  return {
    single: () => [multerUpload, uploadToCloudinary],
  };
};

const uploadPlayerImage = createUploader({
  fieldName: 'image',
  folder: 'inspire_academy/players',
  allowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
  transformation: [
    { width: 400, height: 400, crop: 'fill', gravity: 'face' },
    { quality: 'auto', fetch_format: 'auto' },
  ],
  maxFileSize: 5 * 1024 * 1024,
});

const uploadAcademyLogo = createUploader({
  fieldName: 'logo',
  folder: 'inspire_academy/logos',
  allowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'svg'],
  transformation: [
    { width: 300, height: 300, crop: 'fit' },
    { quality: 'auto', fetch_format: 'auto' },
  ],
  maxFileSize: 2 * 1024 * 1024,
});

const uploadStaffPhoto = createUploader({
  fieldName: 'photo',
  folder: 'inspire_academy/staff',
  allowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
  transformation: [
    { width: 400, height: 400, crop: 'fill', gravity: 'face' },
    { quality: 'auto', fetch_format: 'auto' },
  ],
  maxFileSize: 5 * 1024 * 1024,
});

const deleteImage = async (publicId) => {
  return cloudinary.uploader.destroy(publicId);
};

module.exports = { cloudinary, uploadPlayerImage, uploadAcademyLogo, uploadStaffPhoto, deleteImage };
