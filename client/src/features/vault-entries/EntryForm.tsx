/**
 * The one form that creates and edits all four entry types. In create mode
 * it opens on a type-picker step; choosing a type (or `initialType` being
 * supplied) advances to the field step. In edit mode the type step is
 * skipped entirely and the type renders as a static, non-editable label,
 * matching the server's immutable-type rule (02-02-PLAN.md Task 1).
 *
 * Submit pattern inherited from the 02-01 tracer form:
 * `submitting`/`serverMessage` state, `event.preventDefault()`, clear the
 * message, call the API, invoke `onSaved` on success. Field-level
 * validation is new in this plan — a small per-type required-field list
 * keyed by entry type, validated on submit and on blur, mirroring the
 * server's Zod discriminated union without pulling in a client-side
 * validation library.
 */

import { useEffect, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from "react";
import { KeyRound, LogIn, StickyNote, CreditCard, X } from "lucide-react";
import {
  createEntry,
  listFolders,
  updateEntry,
  type Entry,
  type EntryPayload,
  type EntryType,
  type Folder,
} from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PasswordGenerator from "./PasswordGenerator";

// Radix Select requires non-empty string item values, so "no folder" is
// represented by this sentinel on the wire between this form and the
// Select primitive, then translated to/from `folderId: null` at the
// state/submit boundary.
const UNCATEGORIZED_VALUE = "uncategorized";

interface EntryFormProps {
  onSaved: (entry: Entry) => void;
  /** Present in edit mode. */
  entry?: Entry;
  /** Skips the type-picker step in create mode, opening directly on that type's fields. */
  initialType?: EntryType;
}

// UI-SPEC.md's copy contract — exact string, never substituted with the
// server's own (deliberately generic) entry-CRUD error message.
const SAVE_ERROR_MESSAGE = "Couldn't save this entry. Check your connection and try again.";

interface FieldConfig {
  key: string;
  label: string;
  required: boolean;
  mono?: boolean;
  textarea?: boolean;
  /** Renders the PasswordGenerator addon on this field — only ever the fields that accept a generated secret (VAULT-05). */
  generator?: boolean;
}

const TYPE_FIELDS: Record<EntryType, FieldConfig[]> = {
  api_key: [
    // `key` renders its own PasswordGenerator addon (VAULT-05) for generating a strong key value.
    { key: "key", label: "Key", required: true, mono: true, generator: true },
    { key: "endpoint", label: "Endpoint", required: false },
    { key: "model", label: "Model", required: false },
  ],
  login: [
    { key: "username", label: "Username", required: true },
    // `password` renders its own PasswordGenerator addon (VAULT-05).
    { key: "password", label: "Password", required: true, mono: true, generator: true },
    { key: "url", label: "URL", required: false },
  ],
  note: [{ key: "body", label: "Body", required: false, textarea: true }],
  card: [
    // `number` and `cvv` each render their own independent PasswordGenerator addon (VAULT-05).
    { key: "number", label: "Card number", required: true, mono: true, generator: true },
    { key: "expiry", label: "Expiry", required: true },
    { key: "cvv", label: "CVV", required: true, mono: true, generator: true },
    { key: "cardholder", label: "Cardholder name", required: false },
  ],
};

const TYPE_OPTIONS: Array<{ type: EntryType; label: string; icon: typeof KeyRound }> = [
  { type: "api_key", label: "API key", icon: KeyRound },
  { type: "login", label: "Login", icon: LogIn },
  { type: "note", label: "Secure note", icon: StickyNote },
  { type: "card", label: "Card", icon: CreditCard },
];

const TYPE_LABELS: Record<EntryType, string> = {
  api_key: "API key",
  login: "Login",
  note: "Secure note",
  card: "Card",
};

const CREATE_TITLES: Record<EntryType, string> = {
  api_key: "New API key entry",
  login: "New login entry",
  note: "New secure note entry",
  card: "New card entry",
};

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function buildPayload(type: EntryType, fields: Record<string, string>): EntryPayload {
  switch (type) {
    case "api_key":
      return {
        key: fields.key ?? "",
        endpoint: nonEmpty(fields.endpoint),
        model: nonEmpty(fields.model),
      };
    case "login":
      return {
        username: fields.username ?? "",
        password: fields.password ?? "",
        url: nonEmpty(fields.url),
      };
    case "note":
      return { body: fields.body ?? "" };
    case "card":
      return {
        number: fields.number ?? "",
        expiry: fields.expiry ?? "",
        cvv: fields.cvv ?? "",
        cardholder: nonEmpty(fields.cardholder),
      };
  }
}

function initialFieldsFor(entry: Entry | undefined): Record<string, string> {
  if (!entry) return {};
  const payload = entry.payload as unknown as Record<string, string | undefined>;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    result[key] = value ?? "";
  }
  return result;
}

export default function EntryForm({ onSaved, entry, initialType }: EntryFormProps) {
  const isEditMode = entry != null;
  const [type, setType] = useState<EntryType | null>(entry?.type ?? initialType ?? null);
  const [step, setStep] = useState<"type" | "fields">(type !== null ? "fields" : "type");
  const [name, setName] = useState(entry?.name ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [fields, setFields] = useState<Record<string, string>>(() => initialFieldsFor(entry));
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<string>(entry?.folderId ?? UNCATEGORIZED_VALUE);
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Explicit ref-based focus rather than relying on the `autoFocus` prop:
  // this form renders inside a Radix Dialog, which manages its own initial
  // focus target on open, so focus must be claimed after mount and again
  // whenever the type step advances to the field step.
  useEffect(() => {
    if (step === "fields") nameInputRef.current?.focus();
  }, [step]);

  useEffect(() => {
    let cancelled = false;
    listFolders()
      .then((result) => {
        if (!cancelled) setFolders(result);
      })
      .catch(() => {
        // Fails soft: the select still offers "Uncategorized" even if the
        // rest of the folder list couldn't be fetched — a missing folder
        // list must never block creating or editing an entry.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function commitTagDraft(): void {
    const value = tagDraft.trim();
    if (value.length === 0) return;
    setTags((current) => (current.includes(value) ? current : [...current, value]));
    setTagDraft("");
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTagDraft();
    } else if (event.key === "Backspace" && tagDraft.length === 0 && tags.length > 0) {
      setTags((current) => current.slice(0, -1));
    }
  }

  function removeTag(tag: string): void {
    setTags((current) => current.filter((existing) => existing !== tag));
  }

  function handleSelectType(selected: EntryType): void {
    setType(selected);
    setStep("fields");
  }

  function validateField(key: string, label: string, required: boolean, value: string): void {
    setErrors((current) => {
      const next = { ...current };
      if (required && value.trim().length === 0) {
        next[key] = `${label} is required.`;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  function handleFieldBlur(cfg: FieldConfig): (event: FocusEvent<HTMLElement>) => void {
    return (event) => {
      const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
      validateField(cfg.key, cfg.label, cfg.required, value);
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!type || submitting) return;

    const newErrors: Record<string, string> = {};
    if (name.trim().length === 0) newErrors.name = "Name is required.";
    for (const cfg of TYPE_FIELDS[type]) {
      if (cfg.required && (fields[cfg.key] ?? "").trim().length === 0) {
        newErrors[cfg.key] = `${cfg.label} is required.`;
      }
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    setServerMessage(null);

    try {
      const input = {
        type,
        name,
        folderId: folderId === UNCATEGORIZED_VALUE ? null : folderId,
        notes: notes.trim().length > 0 ? notes : null,
        tags,
        payload: buildPayload(type, fields),
      };
      const saved = isEditMode ? await updateEntry(entry.id, input) : await createEntry(input);
      onSaved(saved);
    } catch {
      setServerMessage(SAVE_ERROR_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "type") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>New entry</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              type="button"
              onClick={() => handleSelectType(opt.type)}
              className="flex flex-col items-center justify-center gap-2 rounded-xl bg-card p-6 text-center ring-1 ring-foreground/10 shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <opt.icon className="size-6 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-semibold">{opt.label}</span>
            </button>
          ))}
        </div>
      </>
    );
  }

  // type is guaranteed non-null once step === "fields" (set together in
  // handleSelectType, or both derived from entry/initialType at mount).
  const activeType = type as EntryType;
  const title = isEditMode ? `Edit ${entry.name}` : CREATE_TITLES[activeType];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      {isEditMode && (
        <p className="text-sm font-semibold text-muted-foreground">{TYPE_LABELS[activeType]}</p>
      )}

      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        {serverMessage && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {serverMessage}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-name">Name</Label>
          <Input
            id="entry-name"
            ref={nameInputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={(event) => validateField("name", "Name", true, event.target.value)}
            readOnly={submitting}
            disabled={submitting}
            aria-invalid={Boolean(errors.name)}
          />
          {errors.name && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {errors.name}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-folder">Folder</Label>
          <Select value={folderId} onValueChange={setFolderId} disabled={submitting}>
            <SelectTrigger id="entry-folder" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNCATEGORIZED_VALUE}>Uncategorized</SelectItem>
              {folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-tags">Tags</Label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-full bg-muted pl-2.5 text-sm font-semibold"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  disabled={submitting}
                  aria-label={`Remove ${tag}`}
                  className="flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
            <input
              id="entry-tags"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={commitTagDraft}
              readOnly={submitting}
              disabled={submitting}
              placeholder={tags.length === 0 ? "Add a tag" : undefined}
              className="min-w-24 flex-1 border-0 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </div>
        </div>

        {TYPE_FIELDS[activeType].map((cfg) => (
          <div key={cfg.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`entry-${cfg.key}`}>{cfg.label}</Label>
            {cfg.textarea ? (
              <Textarea
                id={`entry-${cfg.key}`}
                value={fields[cfg.key] ?? ""}
                onChange={(event) =>
                  setFields((current) => ({ ...current, [cfg.key]: event.target.value }))
                }
                onBlur={handleFieldBlur(cfg)}
                readOnly={submitting}
                disabled={submitting}
                className="max-h-40 overflow-y-auto"
                aria-invalid={Boolean(errors[cfg.key])}
              />
            ) : cfg.generator ? (
              <InputGroup>
                <InputGroupInput
                  id={`entry-${cfg.key}`}
                  value={fields[cfg.key] ?? ""}
                  onChange={(event) =>
                    setFields((current) => ({ ...current, [cfg.key]: event.target.value }))
                  }
                  onBlur={handleFieldBlur(cfg)}
                  readOnly={submitting}
                  disabled={submitting}
                  className={cfg.mono ? "font-mono" : undefined}
                  aria-invalid={Boolean(errors[cfg.key])}
                />
                <InputGroupAddon align="inline-end">
                  <PasswordGenerator
                    onUse={(generated) =>
                      setFields((current) => ({ ...current, [cfg.key]: generated }))
                    }
                  />
                </InputGroupAddon>
              </InputGroup>
            ) : (
              <Input
                id={`entry-${cfg.key}`}
                value={fields[cfg.key] ?? ""}
                onChange={(event) =>
                  setFields((current) => ({ ...current, [cfg.key]: event.target.value }))
                }
                onBlur={handleFieldBlur(cfg)}
                readOnly={submitting}
                disabled={submitting}
                className={cfg.mono ? "font-mono" : undefined}
                aria-invalid={Boolean(errors[cfg.key])}
              />
            )}
            {errors[cfg.key] && (
              <p role="alert" className="text-sm font-semibold text-destructive">
                {errors[cfg.key]}
              </p>
            )}
          </div>
        ))}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-notes">Notes</Label>
          <Textarea
            id="entry-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            readOnly={submitting}
            disabled={submitting}
            className="max-h-40 overflow-y-auto"
          />
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </form>
    </>
  );
}
