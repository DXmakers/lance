import { Router, Request, Response } from "express";
import { prisma } from "../config/db";
import { z } from "zod";
import multer from "multer";

const router = Router();

// Uploads
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/zip",
  "application/json",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// POST /api/v1/uploads
router.post("/", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "no file field found in multipart body" });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: `file type '${file.mimetype}' is not permitted` });
    }

    // TODO: Actually upload to Pinata using PINATA_JWT from process.env
    // Mocking the IPFS hash for now
    const mockCid = "QmMockHash" + Date.now();

    res.status(201).json({ cid: mockCid, filename: file.originalname });
  } catch (error) {
    console.error("POST /uploads error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;