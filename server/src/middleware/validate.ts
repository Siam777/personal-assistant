import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";

/**
 * Returns middleware that parses `req.body` or `req.query` with the given zod schema and
 * assigns the parsed result back. On parse failure, responds HTTP 400 without
 * echoing the offending value — on these routes the offending value could be sensitive.
 */
export function validate(schema: ZodType, target: "body" | "query" = "body"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const dataToValidate = target === "query" ? req.query : req.body;
    const result = schema.safeParse(dataToValidate);
    if (!result.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    if (target === "body") {
      req.body = result.data;
    } else {
      (req as unknown as { validatedQuery: unknown }).validatedQuery = result.data;
    }
    next();
  };
}
