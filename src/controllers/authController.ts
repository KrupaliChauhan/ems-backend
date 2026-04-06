import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User";
import { badRequest, forbidden, ok, serverError } from "../utils/apiResponse";
import { env } from "../config/env";
import { recordAuditLog } from "../services/auditService";
import { sendEmail } from "../services/mailService";
import { logServerError } from "../utils/serverLogger";

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) return badRequest(res, "Invalid credentials");
    if (user.isDeleted) return forbidden(res, "Account deleted");
    if (user.status === "Inactive") return forbidden(res, "Account inactive");

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return badRequest(res, "Invalid credentials");

    const token = jwt.sign({ id: user._id, role: user.role }, env.jwtSecret, {
      expiresIn: "1d"
    });

    await recordAuditLog({
      actorId: String(user._id),
      actorRole: user.role,
      action: "auth.login",
      entityType: "user",
      entityId: String(user._id),
      summary: `${user.email} logged in`,
      metadata: null
    });

    return ok(res, "Login successful", {
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    logServerError("auth.login", error);
    return serverError(res, "Server error");
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user || user.isDeleted || user.status === "Inactive") {
      return ok(res, "If the account exists, a reset link has been sent to your email.");
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const resetLink = `${env.frontendUrl}/reset-password?token=${rawToken}`;
    const sent = await sendEmail({
      context: "auth.forgotPassword.sendMail",
      to: email,
      subject: "Reset your EMS password",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Reset Password</h2>
          <p>You requested to reset your EMS password.</p>
          <p>
            <a href="${resetLink}" style="display:inline-block; padding:10px 16px; background:#4f46e5; color:#fff; text-decoration:none; border-radius:8px;">
              Reset Password
            </a>
          </p>
          <p>This link will expire in <b>15 minutes</b>.</p>
          <p>If you did not request this, you can ignore this email.</p>
        </div>
      `
    });

    if (!sent) {
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save();
      return serverError(res, "Unable to send reset email right now");
    }

    return ok(res, "If the account exists, a reset link has been sent to your email.");
  } catch (error) {
    logServerError("auth.forgotPassword", error);
    return serverError(res, "Failed to process forgot password request");
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
      isDeleted: false
    });

    if (!user) {
      return badRequest(res, "Invalid or expired reset token");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;

    await user.save();

    return ok(res, "Password updated successfully");
  } catch (error) {
    logServerError("auth.resetPassword", error);
    return serverError(res, "Server error");
  }
};
