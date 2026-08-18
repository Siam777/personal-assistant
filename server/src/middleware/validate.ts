import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";

/**
 * Returns middleware that parses `req.body` with the given zod schema and
 * assigns the parsed result back to `req.body`. On parse failure, responds
 * HTTP 400 without echoing the offending value — on these routes the
 * offending value is the master password.
 */
export function validate(schema: ZodType): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    req.body = result.data;
    next();
  };
}
