import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import { getSmtpConfig } from "../config/env";
import { logServerError } from "../utils/serverLogger";

let cachedTransporter:
  | {
      transporter: nodemailer.Transporter;
      fromEmail: string;
    }
  | null = null;

function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const smtp = getSmtpConfig();
  const transportOptions: SMTPTransport.Options = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.password
    },
    tls: {
      servername: smtp.host
    }
  };

  // Render may attempt IPv6 first for some SMTP hosts; forcing IPv4 avoids ENETUNREACH.
  (transportOptions as SMTPTransport.Options & { family?: number }).family = 4;

  cachedTransporter = {
    fromEmail: smtp.user,
    transporter: nodemailer.createTransport(transportOptions)
  };

  return cachedTransporter;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  context: string;
}) {
  try {
    const { fromEmail, transporter } = getTransporter();
    await transporter.sendMail({
      from: `"EMS System" <${fromEmail}>`,
      to: params.to,
      subject: params.subject,
      html: params.html
    });
    return true;
  } catch (error) {
    logServerError(params.context, error);
    return false;
  }
}
