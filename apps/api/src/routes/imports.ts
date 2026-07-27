import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { ImportJobModel } from "../models/import-job";
import { ImportPreviewModel } from "../models/import-preview";
import type { SecretCipher } from "../services/encryption";
import { exportTemplate } from "../services/exporter";
import { parseImport } from "../services/import-parser";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

export function createImportsRouter(cipher: SecretCipher): Router {
  const router = Router();
  router.get("/template", (req, res) => {
    const format = req.query.format === "csv" ? "csv" : "xlsx";
    res.type(format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.attachment(`douyin-account-template.${format}`).send(exportTemplate(format));
  });
  router.post("/preview", upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) throw new Error("IMPORT_FILE_REQUIRED");
      const parsed = parseImport(req.file.buffer, req.file.originalname);
      const stagedRows = parsed.rows.map((row) => ({
        ...row,
        opSecret: cipher.encrypt(row.opSecret)
      }));
      const preview = await ImportPreviewModel.create({
        fileName: req.file.originalname,
        fileType: req.file.originalname.toLowerCase().endsWith(".csv") ? "csv" : req.file.originalname.toLowerCase().endsWith(".xls") ? "xls" : "xlsx",
        ownerSessionId: req.sessionID,
        stagedRows,
        rowErrors: parsed.errors,
        totalRows: parsed.totalRows,
        validRows: parsed.rows.length,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      });
      res.status(201).json({
        previewId: preview.id,
        totalRows: parsed.totalRows,
        validRows: parsed.rows.length,
        errors: parsed.errors,
        rows: parsed.rows.slice(0, 10).map((row) => ({ ...row, opSecret: "••••••" }))
      });
    } catch (error) { next(error); }
  });
  router.post("/execute", async (req, res, next) => {
    try {
      const value = z.object({
        previewId: z.string(),
        duplicateStrategy: z.enum(["skip", "update"])
      }).strict().parse(req.body);
      const preview = await ImportPreviewModel.findOne({
        _id: value.previewId,
        ownerSessionId: req.sessionID
      });
      if (!preview) throw new Error("IMPORT_PREVIEW_NOT_FOUND");
      const job = await ImportJobModel.create({
        previewId: preview.id,
        fileName: preview.fileName,
        duplicateStrategy: value.duplicateStrategy,
        status: "queued",
        total: preview.validRows
      });
      res.status(202).json({ jobId: job.id });
    } catch (error) { next(error); }
  });
  router.get("/", async (_req, res, next) => {
    try { res.json(await ImportJobModel.find().sort({ createdAt: -1 }).limit(100).lean()); } catch (error) { next(error); }
  });
  router.get("/:id", async (req, res, next) => {
    try { res.json(await ImportJobModel.findById(req.params.id).lean()); } catch (error) { next(error); }
  });
  return router;
}
