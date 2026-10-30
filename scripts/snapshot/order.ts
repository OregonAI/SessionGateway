/** Code-unit order, so the same data gives the same file on every machine (`localeCompare` follows the locale). */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
