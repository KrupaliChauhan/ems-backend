import SibApiV3Sdk from "sib-api-v3-sdk";
import { getBrevoConfig } from "../config/env";
import { logServerError } from "../utils/serverLogger";

type SendEmailParams = {
  to: string;
  subject: string;
  htmlContent: string;
  context?: string;
};

type SendEmailBatchRecipient = {
  email: string;
  name?: string;
};

type SendEmailBatchParams = {
  recipients: SendEmailBatchRecipient[];
  subject: string;
  htmlContent: string;
  context?: string;
};

let transactionalEmailsApi: any = null;

function toErrorWithDetails(error: unknown) {
  if (error instanceof Error) {
    const responseBody =
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof (error as { response?: unknown }).response === "object" &&
      (error as { response?: { body?: unknown } }).response?.body
        ? JSON.stringify((error as { response?: { body?: unknown } }).response?.body)
        : null;

    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status !== "undefined"
        ? String((error as { status?: unknown }).status)
        : null;

    if (!responseBody && !status) {
      return error;
    }

    const parts = [error.message];
    if (status) {
      parts.push(`status=${status}`);
    }
    if (responseBody) {
      parts.push(`response=${responseBody}`);
    }

    return new Error(parts.join(" | "));
  }

  return new Error(typeof error === "string" ? error : "Unknown email error");
}

function getTransactionalEmailsApi() {
  if (transactionalEmailsApi) {
    return transactionalEmailsApi;
  }

  const client = SibApiV3Sdk.ApiClient.instance;
  const apiKey = client.authentications["api-key"];
  apiKey.apiKey = getBrevoConfig().apiKey;

  transactionalEmailsApi = new SibApiV3Sdk.TransactionalEmailsApi();
  return transactionalEmailsApi;
}

function createSender() {
  const { senderEmail, senderName } = getBrevoConfig();

  return {
    email: senderEmail,
    name: senderName
  };
}

export async function sendEmail({ to, subject, htmlContent, context = "mail.sendEmail" }: SendEmailParams) {
  try {
    const apiInstance = getTransactionalEmailsApi();

    await apiInstance.sendTransacEmail({
      sender: createSender(),
      to: [{ email: to }],
      subject,
      htmlContent
    });

    return true;
  } catch (error) {
    logServerError(context, toErrorWithDetails(error));
    return false;
  }
}

export async function sendEmailBatch({
  recipients,
  subject,
  htmlContent,
  context = "mail.sendEmailBatch"
}: SendEmailBatchParams) {
  if (recipients.length === 0) {
    return;
  }

  await Promise.allSettled(
    recipients.map((recipient) =>
      sendEmail({
        to: recipient.email,
        subject,
        htmlContent: htmlContent.replace(/\{\{name\}\}/g, recipient.name || recipient.email),
        context
      })
    )
  );
}

export default sendEmail;
