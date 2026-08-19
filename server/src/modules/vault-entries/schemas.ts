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
  name: z.string().min(1).max(200),
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

export type EntryPayload =
  | z.infer<typeof apiKeyPayloadSchema>
  | z.infer<typeof loginPayloadSchema>
  | z.infer<typeof notePayloadSchema>
  | z.infer<typeof cardPayloadSchema>;
