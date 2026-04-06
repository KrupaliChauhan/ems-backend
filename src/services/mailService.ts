import { lookup } from "node:dns/promises";
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

async function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const smtp = getSmtpConfig();
  const resolvedHost = await lookup(smtp.host, { family: 4 });
  const transportOptions: SMTPTransport.Options = {
    host: resolvedHost.address,
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
    const { fromEmail, transporter } = await getTransporter();
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
