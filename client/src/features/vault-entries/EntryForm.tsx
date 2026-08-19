/**
 * API key entry creation form. One entry type only in this plan (D-01/D-02
 * — the full type is wired end-to-end for `api_key`; the other three types
 * gain a UI in Plan 02-02). Submit pattern copied from
 * `vault-unlock/UnlockScreen.tsx`: `submitting`/`serverMessage` state,
 * `event.preventDefault()`, clear the message, call the API, invoke the
 * `onSaved` callback on success.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createEntry, type Entry } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface EntryFormProps {
  onSaved: (entry: Entry) => void;
}

// UI-SPEC.md's copy contract — exact string, never substituted with the
// server's own (deliberately generic) entry-CRUD error message.
const SAVE_ERROR_MESSAGE = "Couldn't save this entry. Check your connection and try again.";

export default function EntryForm({ onSaved }: EntryFormProps) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Explicit ref-based focus rather than relying on the `autoFocus` prop:
  // this form renders inside a Radix Dialog, which manages its own initial
  // focus target on open, so focus must be claimed after mount.
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const canSubmit = name.trim().length > 0 && key.trim().length > 0 && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setServerMessage(null);

    try {
      const entry = await createEntry({
        type: "api_key",
        name,
        notes: notes.trim().length > 0 ? notes : null,
        payload: {
          key,
          endpoint: endpoint.trim().length > 0 ? endpoint : undefined,
          model: model.trim().length > 0 ? model : undefined,
        },
      });
      onSaved(entry);
    } catch {
      setServerMessage(SAVE_ERROR_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
          readOnly={submitting}
          disabled={submitting}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="entry-key">Key</Label>
        <Input
          id="entry-key"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          readOnly={submitting}
          disabled={submitting}
          className="font-mono"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="entry-endpoint">Endpoint</Label>
        <Input
          id="entry-endpoint"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          readOnly={submitting}
          disabled={submitting}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="entry-model">Model</Label>
        <Input
          id="entry-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          readOnly={submitting}
          disabled={submitting}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="entry-notes">Notes</Label>
        <Textarea
          id="entry-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          readOnly={submitting}
          disabled={submitting}
        />
      </div>

      <Button type="submit" disabled={!canSubmit}>
        {submitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
