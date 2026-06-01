/**
 * rbac.ts — Role-Based Access Control middleware (Freelancer vs Client)
 *
 * Usage:
 *   router.get("/my-jobs", authGuard, requireRole("freelancer"), handler);
 *   router.post("/post-job", authGuard, requireRole("client", "admin"), handler);
 */

import { Request, Response, NextFunction } from "express";

export type UserRole = "freelancer" | "client" | "admin";

/**
 * Returns middleware that rejects the request with 403 if the authenticated
 * user's role (carried in `req.auth.role`) is not in the allowed set.
 * Must be applied after `authGuard`, which populates `req.auth`.
 */
export function requireRole(...allowed: UserRole[]) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const role = (req as Request & { auth?: { role?: string } }).auth?.role as
			| UserRole
			| undefined;

		if (!role) {
			res.status(403).json({ error: "Role information missing from token" });
			return;
		}

		if (!allowed.includes(role)) {
			res.status(403).json({ error: "Insufficient permissions" });
			return;
		}

		next();
	};
}
