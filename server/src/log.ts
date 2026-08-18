/**
 * The only logging surface this server may use. Every other module must
 * reach standard output only through `logInfo` / `logError` — that is what
 * makes D-02's "never log the master password or derived key at any level"
 * mechanically true rather than a convention someone has to remember.
 *
 * Both functions run the `fields` object through a recursive redactor that
 * replaces two things with the fixed string "[REDACTED]":
 *   - the value of any key matching SECRET_KEY_PATTERN
 *   - any Buffer value, found anywhere in the object, regardless of its key
 */

const REDACTED = "[REDACTED]";

const SECRET_KEY_PATTERN =
  /password|secret|key|token|code|salt|iv|authtag|cipher(text)?/i;

export type LogFields = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value)
  );
}

function redact(value: unknown, keyName?: string): unknown {
  if (Buffer.isBuffer(value)) {
    return REDACTED;
  }

  if (keyName !== undefined && SECRET_KEY_PATTERN.test(keyName)) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = redact(val, key);
    }
    return result;
  }

  return value;
}

function redactFields(fields: LogFields | undefined): LogFields | undefined {
  if (fields === undefined) return undefined;
  const redacted = redact(fields);
  return isPlainObject(redacted) ? redacted : { value: redacted };
}

export function logInfo(msg: string, fields?: LogFields): void {
  const safeFields = redactFields(fields);
  if (safeFields !== undefined) {
    console.log(msg, safeFields);
  } else {
    console.log(msg);
  }
}

export function logError(msg: string, fields?: LogFields): void {
  const safeFields = redactFields(fields);
  if (safeFields !== undefined) {
    console.error(msg, safeFields);
  } else {
    console.error(msg);
  }
}
