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

export function getBrevoConfig() {
  const apiKey = requireEnv("BREVO_API_KEY");
  const senderEmail =
    optionalEnv("BREVO_SENDER_EMAIL") ||
    optionalEnv("EMAIL_FROM") ||
    optionalEnv("MAIL_FROM_EMAIL");
  const senderName =
    optionalEnv("BREVO_SENDER_NAME") ||
    optionalEnv("MAIL_FROM_NAME") ||
    "EMS System";

  if (!senderEmail) {
    throw new Error(
      "Brevo sender configuration is incomplete. Set BREVO_SENDER_EMAIL, EMAIL_FROM, or MAIL_FROM_EMAIL."
    );
  }

  if (apiKey.startsWith("xsmtpsib-")) {
    throw new Error(
      "BREVO_API_KEY is using an SMTP key (xsmtpsib-). The Brevo REST API SDK requires an API key, which usually starts with xkeysib-."
    );
  }

  return {
    apiKey,
    senderEmail,
    senderName
  };
}
