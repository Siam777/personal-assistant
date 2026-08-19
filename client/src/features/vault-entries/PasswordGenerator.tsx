/**
 * Inline password generator (VAULT-05). Only ever appears attached to a
 * field that accepts a generated secret, via an `InputGroup` trailing
 * addon in `EntryForm.tsx` — never as a standalone top-level tool
 * (02-UI-SPEC.md's "Note on password generator placement").
 *
 * `generatePassword` is a pure function with no React dependency, drawing
 * every index from `crypto.getRandomValues` via rejection sampling so no
 * character of the enabled alphabet is ever more likely than another
 * (T-02-21). The non-cryptographic pseudo-random generator built into the
 * language runtime must never appear in this file — it has no
 * cryptographic guarantee and would silently weaken every password
 * generated through it.
 */

import { useEffect, useState } from "react";
import { Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 64;
export const DEFAULT_LENGTH = 20;

const UPPER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER_CHARS = "abcdefghijklmnopqrstuvwxyz";
const NUMBER_CHARS = "0123456789";
const SYMBOL_CHARS = "!@#$%^&*()-_=+[]{};:,.<>?";

export interface GeneratePasswordOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  numbers: boolean;
  symbols: boolean;
}

/**
 * Draws one unbiased index in `[0, max)` from `crypto.getRandomValues`.
 * Computes the largest multiple of `max` that fits in a byte (0-255),
 * discards any drawn byte at or above that threshold, and takes the
 * remainder of an accepted byte — a plain `byte % max` without the
 * threshold discard is a modulo bias and is not used here.
 */
function randomIndex(max: number): number {
  const threshold = Math.floor(256 / max) * max;
  const bytes = new Uint8Array(1);
  let drawn: number;
  do {
    crypto.getRandomValues(bytes);
    drawn = bytes[0];
  } while (drawn >= threshold);
  return drawn % max;
}

/**
 * Builds the alphabet from exactly the enabled classes — no confusable-
 * character exclusion, no post-generation filtering (T-02-22), either of
 * which would silently cut the entropy below what the user's settings
 * imply. Guarantees at least one character from each enabled class by
 * seeding the result with one draw per class, fills the remainder from the
 * full alphabet, then runs a Fisher-Yates shuffle whose swap indices come
 * from the same rejection-sampled source, so class-guarantee placement
 * never leaks a predictable position. Throws when no class is enabled —
 * the UI prevents this state and this function must not invent a fallback
 * alphabet.
 */
export function generatePassword(options: GeneratePasswordOptions): string {
  const classes: string[] = [];
  if (options.upper) classes.push(UPPER_CHARS);
  if (options.lower) classes.push(LOWER_CHARS);
  if (options.numbers) classes.push(NUMBER_CHARS);
  if (options.symbols) classes.push(SYMBOL_CHARS);

  if (classes.length === 0) {
    throw new Error("Select at least one character type");
  }

  const alphabet = classes.join("");
  const result: string[] = classes.map((cls) => cls[randomIndex(cls.length)]);

  while (result.length < options.length) {
    result.push(alphabet[randomIndex(alphabet.length)]);
  }

  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result.join("");
}

interface PasswordGeneratorProps {
  onUse: (value: string) => void;
}

export default function PasswordGenerator({ onUse }: PasswordGeneratorProps) {
  const [open, setOpen] = useState(false);
  const [length, setLength] = useState(DEFAULT_LENGTH);
  const [upper, setUpper] = useState(true);
  const [lower, setLower] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [value, setValue] = useState(() =>
    generatePassword({ length: DEFAULT_LENGTH, upper: true, lower: true, numbers: true, symbols: true })
  );

  const anyEnabled = upper || lower || numbers || symbols;

  // Synchronous and instant, so there is no loading state — the preview
  // simply changes whenever length or any toggle changes.
  useEffect(() => {
    if (!anyEnabled) {
      setValue("");
      return;
    }
    setValue(generatePassword({ length, upper, lower, numbers, symbols }));
  }, [length, upper, lower, numbers, symbols, anyEnabled]);

  function handleRegenerate(): void {
    if (!anyEnabled) return;
    setValue(generatePassword({ length, upper, lower, numbers, symbols }));
  }

  function handleUse(): void {
    if (!anyEnabled || value.length === 0) return;
    onUse(value);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Generate password"
          className="flex size-11 shrink-0 items-center justify-center"
        >
          <Dices className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="pw-gen-length">Length</Label>
            <span className="text-sm font-semibold text-muted-foreground">{length}</span>
          </div>
          <Slider
            id="pw-gen-length"
            min={MIN_LENGTH}
            max={MAX_LENGTH}
            step={1}
            value={[length]}
            onValueChange={(next) => setLength(next[0] ?? DEFAULT_LENGTH)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="pw-gen-upper">Uppercase</Label>
            <Switch id="pw-gen-upper" checked={upper} onCheckedChange={setUpper} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pw-gen-lower">Lowercase</Label>
            <Switch id="pw-gen-lower" checked={lower} onCheckedChange={setLower} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pw-gen-numbers">Numbers</Label>
            <Switch id="pw-gen-numbers" checked={numbers} onCheckedChange={setNumbers} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pw-gen-symbols">Symbols</Label>
            <Switch id="pw-gen-symbols" checked={symbols} onCheckedChange={setSymbols} />
          </div>
        </div>

        <div className="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm">
          {anyEnabled ? (
            <span className="font-mono break-all">{value}</span>
          ) : (
            <span className="text-muted-foreground">Select at least one character type</span>
          )}
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={!anyEnabled} onClick={handleRegenerate}>
            Regenerate
          </Button>
          <Button type="button" disabled={!anyEnabled} onClick={handleUse}>
            Use this password
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
