import express from "express";
import { login, forgotPassword, resetPassword } from "../controllers/authController";
import { loginLimiter, forgotPasswordLimiter } from "../middleware/rateLimiters";
import {
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} from "../validation/authValidation";
import { validateBody } from "../middleware/validate";

const router = express.Router();

router.post("/login", loginLimiter, validateBody(loginSchema), login);

// ✅ ADD
router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  validateBody(forgotPasswordSchema),
  forgotPassword
);

// ✅ ADD
router.post(
  "/reset-password",
  forgotPasswordLimiter,
  validateBody(resetPasswordSchema),
  resetPassword
);

export default router;
