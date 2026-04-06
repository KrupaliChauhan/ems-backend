import type { Request } from "express";
import type { AppRole } from "../constants/roles";

export type AuthUser = {
  id: string;
  role: AppRole;
};

export type AuthenticatedRequest = Request & {
  user?: AuthUser;
};

export function getRequestAuthUser(req: Request) {
  return (req as AuthenticatedRequest).user ?? null;
}

