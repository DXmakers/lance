"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const router = (0, express_1.Router)();
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
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
});
// POST /api/v1/uploads
router.post("/", upload.single("file"), async (req, res) => {
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
    }
    catch (error) {
        console.error("POST /uploads error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
