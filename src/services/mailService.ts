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

type SmtpConfig = ReturnType<typeof getSmtpConfig>;

async function buildTransporter(smtp: SmtpConfig, overrides?: Partial<SMTPTransport.Options>) {
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
    },
    ...overrides
  };

  return nodemailer.createTransport(transportOptions);
}

async function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const smtp = getSmtpConfig();
  cachedTransporter = {
    fromEmail: smtp.user,
    transporter: await buildTransporter(smtp)
  };

  return cachedTransporter;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  context: string;
}) {
  const smtp = getSmtpConfig();

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

    const shouldTryTlsFallback = smtp.port === 465 && smtp.secure;
    if (!shouldTryTlsFallback) {
      return false;
    }

    try {
      const fallbackTransporter = await buildTransporter(smtp, {
        port: 587,
        secure: false,
        requireTLS: true
      });

      await fallbackTransporter.sendMail({
        from: `"EMS System" <${smtp.user}>`,
        to: params.to,
        subject: params.subject,
        html: params.html
      });

      cachedTransporter = {
        fromEmail: smtp.user,
        transporter: fallbackTransporter
      };

      return true;
    } catch (fallbackError) {
      logServerError(`${params.context}.fallback587`, fallbackError);
      return false;
    }
  }
}
