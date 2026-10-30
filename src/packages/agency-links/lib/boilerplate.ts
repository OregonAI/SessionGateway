/**
 * Text that the printed form of a Version repeats on every Measure and that says nothing about
 * this one. An Enrolled Version ends with a filing block: "Filed in Office of Secretary of State:"
 * and, under a line of dots, the Secretary of State's signature line ("Tobias Read, Secretary of
 * State"). The registry has a row for the Secretary of State, so left in, every Enrolled Version
 * would link to it (spec #1, story 34: the evidence has to stay honest).
 *
 * These are patterns over the printed text, not registry slugs: the registry arrives as a
 * parameter, and a sentence that names the Secretary of State inside a Measure's own text is still
 * a link. Each pattern removes only the printed form's fixed words. The result is for matching
 * only: nothing served to an agent comes from it.
 */
const printedBoilerplate: readonly RegExp[] = [
  /Filed in Office of Secretary of State:/g,
  // The signature lines hang under a line of dots, as pdftotext prints them.
  /^\.{5,}[ \t]*\n[^\n]*, Secretary of State[ \t]*$/gm,
];

export function withoutPrintedBoilerplate(text: string): string {
  return printedBoilerplate.reduce((rest, pattern) => rest.replace(pattern, ""), text);
}
