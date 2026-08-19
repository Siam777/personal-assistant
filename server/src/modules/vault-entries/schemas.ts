/**
 * Zod contracts for vault entries. One payload schema per entry type
 * (D-02 in 02-CONTEXT.md — type-specific fields validated in application
 * code, stored as an opaque JSON blob rather than typed DB columns), and a
 * single discriminated union covering all four types (D-01). All four
 * types are defined here even though only `api_key` has a UI in this plan
 * — splitting the union across plans would force a rewrite of it later.
 *
 * Field shapes follow REQUIREMENTS.md's parenthetical field lists for each
 * entry type (Claude's-discretion item in 02-CONTEXT.md).
 */

import { z } from "zod";

export const entryTypeSchema = z.enum(["api_key", "login", "note", "card"]);
export type EntryType = z.infer<typeof entryTypeSchema>;

export const apiKeyPayloadSchema = z.object({
  key: z.string().min(1),
  endpoint: z.string().optional(),
  model: z.string().optional(),
});

export const loginPayloadSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  url: z.string().optional(),
});

// A blank note is a valid note — the body is deliberately unconstrained
// (no `.min(1)`), unlike every other type's required secret field.
export const notePayloadSchema = z.object({
  body: z.string(),
});

export const cardPayloadSchema = z.object({
  number: z.string().min(1),
  expiry: z.string().min(1),
  cvv: z.string().min(1),
  cardholder: z.string().optional(),
});

// D-03: every entry, regardless of type, also gets one optional freeform
// `notes` field in addition to its type-specific fields.
const commonEntryFields = {
  // `.trim()` runs before `.min(1)`, so a whitespace-only name (e.g. "   ")
  // is rejected exactly like an empty string — a name that is visually
  // blank must not be accepted as valid (02-02-PLAN.md Task 1, edge case 8).
  name: z.string().trim().min(1).max(200),
  folderId: z.string().nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
};

export const entryCreateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("api_key"),
    payload: apiKeyPayloadSchema,
    ...commonEntryFields,
  }),
  z.object({
    type: z.literal("login"),
    payload: loginPayloadSchema,
    ...commonEntryFields,
  }),
  z.object({
    type: z.literal("note"),
    payload: notePayloadSchema,
    ...commonEntryFields,
  }),
  z.object({
    type: z.literal("card"),
    payload: cardPayloadSchema,
    ...commonEntryFields,
  }),
]);

export type EntryCreateInput = z.infer<typeof entryCreateSchema>;

/**
 * Full-representation update contract (02-02-PLAN.md Task 1): the client
 * always submits every mutable field on PATCH. Unlike `entryCreateSchema`,
 * `folderId`/`notes`/`tags` are REQUIRED (not `.optional()`) here — a PATCH
 * that omits one of these fields must fail validation with a 400 rather
 * than silently being treated as "clear this field" by `updateEntry`'s
 * `input.tags ?? []` / `input.folderId ?? null` / `input.notes ?? null`
 * defaults (CR-01, 02-REVIEW.md). `folderId`/`notes` stay nullable — an
 * entry legitimately has no folder or no notes — but the key must be
 * present. `updateEntry` in `entries.ts` is the one place that additionally
 * enforces the immutable-type rule (stored `type` must match `input.type`)
 * — this schema only validates shape, not identity against an existing row.
 */
const commonUpdateFields = {
  name: commonEntryFields.name,
  folderId: z.string().nullable(),
  notes: z.string().max(10000).nullable(),
  tags: z.array(z.string().min(1).max(50)),
};

export const entryUpdateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("api_key"),
    payload: apiKeyPayloadSchema,
    ...commonUpdateFields,
  }),
  z.object({
    type: z.literal("login"),
    payload: loginPayloadSchema,
    ...commonUpdateFields,
  }),
  z.object({
    type: z.literal("note"),
    payload: notePayloadSchema,
    ...commonUpdateFields,
  }),
  z.object({
    type: z.literal("card"),
    payload: cardPayloadSchema,
    ...commonUpdateFields,
  }),
]);

export type EntryUpdateInput = z.infer<typeof entryUpdateSchema>;

export type EntryPayload =
  | z.infer<typeof apiKeyPayloadSchema>
  | z.infer<typeof loginPayloadSchema>
  | z.infer<typeof notePayloadSchema>
  | z.infer<typeof cardPayloadSchema>;

// --- Folders & search (02-03-PLAN.md) -------------------------------------

export const folderCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type FolderCreateInput = z.infer<typeof folderCreateSchema>;

// Same shape as create — renaming a folder is submitting a new full name,
// not a partial patch.
export const folderRenameSchema = folderCreateSchema;
export type FolderRenameInput = z.infer<typeof folderRenameSchema>;

/**
 * Validates `GET /entries`'s query string. `validate()` (the shared
 * middleware) only ever parses `req.body`, so the route handler parses
 * this one explicitly with `safeParse` rather than adding a second
 * middleware for the one query-string route in this router.
 */
export const entryListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  folderId: z.string().optional(),
  tag: z.string().optional(),
  deleted: z.literal("true").optional(),
});
export type EntryListQuery = z.infer<typeof entryListQuerySchema>;
