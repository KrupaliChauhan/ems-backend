import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 5000),
  mongoUri: requireEnv("MONGO_URI"),
  jwtSecret: requireEnv("JWT_SECRET"),
  frontendUrl: requireEnv("FRONTEND_URL")
};

export function getSmtpConfig() {
  const host = optionalEnv("SMTP_EMAIL_HOST");
  const port = optionalEnv("SMTP_EMAIL_PORT");
  const user = optionalEnv("SMTP_EMAIL_USER");
  const password = optionalEnv("SMTP_EMAIL_PASSWORD");

  if (!host || !port || !user || !password) {
    throw new Error("SMTP configuration is incomplete");
  }
  console.log("EMAIL_USER:", process.env.EMAIL_USER);
  console.log("EMAIL_PASS:", process.env.EMAIL_PASS);
  return {
    host,
    port: Number(port),
    secure: process.env.SMTP_EMAIL_SECURE === "true",
    user,
    password
  };
}
