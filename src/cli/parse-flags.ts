export type FlagsResult =
  | { readonly ok: true; readonly values: ReadonlyMap<string, string> }
  | { readonly message: string; readonly ok: false };

export function parseFlags(arguments_: readonly string[], allowed: readonly string[]): FlagsResult {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (typeof flag === "undefined" || typeof value === "undefined") {
      return { ok: false, message: `Missing value for ${flag ?? "option"}.` };
    }
    if (!allowed.includes(flag)) return { ok: false, message: `Unknown option: ${flag}` };
    values.set(flag, value);
  }
  return { ok: true, values };
}
