import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { badRequest } from "../utils/apiResponse";

export const validateBody =
  (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((e) => ({
        field: e.path.join("."),
        message: e.message
      }));
      return badRequest(res, "Validation failed", errors);
    }
    req.body = parsed.data;
    next();
  };
