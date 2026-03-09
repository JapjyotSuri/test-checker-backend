const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = uploadsDir;
    
    // Create subdirectories based on upload type
    if (req.baseUrl.includes('tests')) {
      uploadPath = path.join(uploadsDir, 'tests');
    } else if (req.baseUrl.includes('attempts')) {
      uploadPath = path.join(uploadsDir, 'answer_sheet');
    } else if (req.baseUrl.includes('test-series')) {
      // images for test series
      uploadPath = path.join(uploadsDir, 'series');
    }
    
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// File filter - allow PDFs for tests/attempts and images for series
const fileFilter = (req, file, cb) => {
  // tests and attempts expect PDFs
  if (req.baseUrl.includes('tests') || req.baseUrl.includes('attempts')) {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    return cb(new Error('Only PDF files are allowed for tests/attempts'), false);
  }

  // series images - allow common image types
  if (req.baseUrl.includes('test-series')) {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Only image files (png, jpg, webp) are allowed for series images'), false);
  }

  // default: reject
  return cb(new Error('Unsupported upload destination'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB default
  }
});

module.exports = upload;

