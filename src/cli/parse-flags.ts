export type FlagsResult =
  | { readonly ok: true; readonly values: ReadonlyMap<string, string> }
  | { readonly message: string; readonly ok: false };

export function parseFlags(
  arguments_: readonly string[],
  allowed: readonly string[],
  booleanFlags: readonly string[] = [],
): FlagsResult {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length;) {
    const flag = arguments_[index];
    if (typeof flag === "undefined") break;
    if (!allowed.includes(flag)) return { ok: false, message: `Unknown option: ${flag}` };
    if (booleanFlags.includes(flag)) {
      values.set(flag, "true");
      index += 1;
      continue;
    }
    const value = arguments_[index + 1];
    if (typeof value === "undefined" || value.startsWith("--")) {
      return { ok: false, message: `Missing value for ${flag}.` };
    }
    values.set(flag, value);
    index += 2;
  }
  return { ok: true, values };
}
