import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "REDIS_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
  | "CRAWL_NOT_FOUND"
  | "EXPORT_NOT_READY"
  | "EXPORT_NOT_FOUND"
  | "REQUEST_FAILED"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  status: number;
  code: ErrorCode;
  action?: string;

  constructor(status: number, code: ErrorCode, message: string, action?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.action = action;
  }
}

export function sendError(res: Response, error: ApiError): void {
  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      action: error.action
    }
  });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ApiError) {
    sendError(res, error);
    return;
  }

  if (error instanceof ZodError) {
    sendError(
      res,
      new ApiError(
        400,
        "VALIDATION_ERROR",
        "Some crawl settings are invalid.",
        error.issues.map((issue) => issue.message).join(" ")
      )
    );
    return;
  }

  console.error(error);
  sendError(
    res,
    new ApiError(
      500,
      "INTERNAL_ERROR",
      "Something went wrong while processing the request.",
      "Check the API logs, then try again."
    )
  );
}
