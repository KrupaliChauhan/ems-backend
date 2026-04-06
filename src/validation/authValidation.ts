import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("Valid email required"),
  password: z.string().min(1, "Password is required")
});

// ✅ ADD
export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Valid email required")
});

// ✅ ADD
export const resetPasswordSchema = z.object({
  token: z.string().min(10, "Token is required"),
  newPassword: z.string().min(6, "Password must be at least 6 characters")
});
