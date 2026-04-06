import { NextFunction, Request, Response } from "express";

export const notFound = (req: Request, res: Response) => {
  res
    .status(404)
    .json({ success: false, message: `Route not found: ${req.originalUrl}` });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const statusCode =
    res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  const isProd = process.env.NODE_ENV === "production";
  const error = err instanceof Error ? err : new Error("Server error");

  res.status(statusCode).json({
    success: false,
    message: error.message,
    ...(isProd ? {} : { stack: error.stack }),
  });
};
