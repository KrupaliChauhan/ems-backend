import type { Response } from "express";

export type ApiErrorItem = {
  field?: string;
  message: string;
};

type EnvelopeOptions<T> = {
  status: number;
  success: boolean;
  message: string;
  data?: T;
  errors?: ApiErrorItem[];
  extra?: Record<string, unknown>;
};

function buildEnvelope<T>({
  success,
  message,
  data,
  errors,
  extra
}: Omit<EnvelopeOptions<T>, "status">) {
  return {
    success,
    message,
    ...(data !== undefined ? { data } : {}),
    ...(errors && errors.length > 0 ? { errors } : {}),
    ...(extra || {})
  };
}

function sendEnvelope<T>(res: Response, options: EnvelopeOptions<T>) {
  return res.status(options.status).json(
    buildEnvelope({
      success: options.success,
      message: options.message,
      data: options.data,
      errors: options.errors,
      extra: options.extra
    })
  );
}

export function ok<T>(res: Response, message: string, data?: T, extra?: Record<string, unknown>) {
  return sendEnvelope(res, { status: 200, success: true, message, data, extra });
}

export function created<T>(res: Response, message: string, data?: T, extra?: Record<string, unknown>) {
  return sendEnvelope(res, { status: 201, success: true, message, data, extra });
}

export function badRequest(
  res: Response,
  message: string,
  errors?: ApiErrorItem[],
  extra?: Record<string, unknown>
) {
  return sendEnvelope(res, { status: 400, success: false, message, errors, extra });
}

export function unauthorized(res: Response, message: string, extra?: Record<string, unknown>) {
  return sendEnvelope(res, { status: 401, success: false, message, extra });
}

export function forbidden(res: Response, message: string, extra?: Record<string, unknown>) {
  return sendEnvelope(res, { status: 403, success: false, message, extra });
}

export function notFound(res: Response, message: string, extra?: Record<string, unknown>) {
  return sendEnvelope(res, { status: 404, success: false, message, extra });
}

export function serverError(res: Response, message: string = "Server error", extra?: Record<string, unknown>) {
  return sendEnvelope(res, { status: 500, success: false, message, extra });
}
