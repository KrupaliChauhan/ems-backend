import fs from "node:fs";
import path from "node:path";
import multer from "multer";

const uploadDir = path.resolve(process.cwd(), "uploads", "leave-attachments");
fs.mkdirSync(uploadDir, { recursive: true });

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 40);

    cb(null, `${Date.now()}-${safeName}${ext}`);
  }
});

export const leaveAttachmentUpload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error("Only PDF, PNG, JPG, JPEG, DOC and DOCX files are allowed"));
    }
    cb(null, true);
  }
});

export function getLeaveAttachmentPublicUrl(fileName: string) {
  return `/uploads/leave-attachments/${fileName}`;
}
