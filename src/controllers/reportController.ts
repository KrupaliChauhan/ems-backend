import type { Request, Response } from "express";
import { ok, serverError } from "../utils/apiResponse";
import {
  getAssetReport,
  getAttendanceReport,
  getEmployeeReport,
  getLeaveReport,
  getProjectReport,
  getReportFilterOptions
} from "../services/reportService";

function normalizeQuery(req: Request) {
  return req.query as Record<string, string | string[] | undefined>;
}

export async function listReportFilters(_req: Request, res: Response) {
  try {
    const data = await getReportFilterOptions();
    return ok(res, "Report filters fetched successfully", data);
  } catch {
    return serverError(res, "Failed to fetch report filters");
  }
}

export async function getAttendanceReportHandler(req: Request, res: Response) {
  try {
    const data = await getAttendanceReport(normalizeQuery(req));
    return ok(res, "Attendance report fetched successfully", data);
  } catch {
    return serverError(res, "Failed to fetch attendance report");
  }
}

export async function getLeaveReportHandler(req: Request, res: Response) {
  try {
    const data = await getLeaveReport(normalizeQuery(req));
    return ok(res, "Leave report fetched successfully", data);
  } catch {
    return serverError(res, "Failed to fetch leave report");
  }
}

export async function getAssetReportHandler(req: Request, res: Response) {
  try {
    const data = await getAssetReport(normalizeQuery(req));
    return ok(res, "Asset report fetched successfully", data);
  } catch {
    return serverError(res, "Failed to fetch asset report");
  }
}

export async function getProjectReportHandler(req: Request, res: Response) {
  try {
    const data = await getProjectReport(normalizeQuery(req));
    return ok(res, "Project report fetched successfully", data);
  } catch {
    return serverError(res, "Failed to fetch project report");
  }
}

export async function getEmployeeReportHandler(req: Request, res: Response) {
  try {
    const data = await getEmployeeReport(normalizeQuery(req));
    return ok(res, "Employee report fetched successfully", data);
  } catch {
    return serverError(res, "Failed to fetch employee report");
  }
}
