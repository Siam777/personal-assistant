/**
 * Debounced search input. A controlled draft state renders every keystroke
 * immediately; `onChange` (the actual fetch trigger, owned by the parent)
 * fires only once no keystroke has landed for 300ms, so there is no
 * per-keystroke request and no per-keystroke spinner. `searching` swaps
 * the leading icon for a spinner while a request from that debounced value
 * is in flight.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

interface SearchBarProps {
  value: string;
  onChange: (next: string) => void;
  searching: boolean;
}

export default function SearchBar({ value, onChange, searching }: SearchBarProps) {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keeps the visible draft in sync when the parent resets `value`
  // externally (e.g. the "Clear filters" action) without going through a
  // keystroke or the debounce timer.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleChange(next: string): void {
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onChange(next);
    }, 300);
  }

  function handleClear(): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    setDraft("");
    onChange("");
  }

  return (
    <InputGroup>
      <InputGroupAddon>
        {searching ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Search className="size-4" aria-hidden="true" />
        )}
      </InputGroupAddon>
      <InputGroupInput
        value={draft}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="Search entries"
        aria-label="Search entries"
      />
      {draft.length > 0 && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            size="icon-xs"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <X className="size-3.5" aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
