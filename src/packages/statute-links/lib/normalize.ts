// What a Proposed Amendment prints at the foot of each page. `pdftotext` prints it on three lines:
//   SB 69-1 1/17/25
//   Proposed Amendments to SB 69
//   Page 13
// PDF.js, which wrote the text the store holds (ADR-0010), prints it on two, the second running the title and the page
// number together and ending in the form feed that starts the next page:
//   SB 69-1 1/17/25
//   Proposed Amendments to SB 69 Page 13
// An amendment to an engrossed bill names it, and may add a note:
//   Proposed Amendments to B-Eng. HB 3544 (A to RC)
// A Version and a printed amendment print their own furniture (#170). A Version prints its page number at the foot of
// each page and the measure, engrossed or not, at the head of the next; its first page ends with the NOTE on boldfaced
// and bracketed type and the LC number:
//   [4]
//   HB 4015            A-Eng. HB 4040            MR A-Eng. SB 1507
//   NOTE: Matter in boldfaced type in an amended section is new; matter [italic and bracketed] is existing law to be omitted.
//   New sections are in boldfaced type.
//   LC 228
// An Enrolled bill prints only a footer: "Enrolled Senate Bill 1507 (SB 1507-A) Page 43". A printed amendment prints
// "SA to SB 1544 Page 6" (HA, SMRA, HMRA; "to A-Eng. HB 4035") at the foot, and its first page ends with
// "LC 290/SB 1570-5". In 2026R1's stored Versions and printed amendments each of these lines stands only at the head or
// the foot of a page (measured 2026-11-10), so a line is dropped wherever it stands, as the footers above are.
// A citation can run over a page break, so the footer has to go for "ORS" and its number to meet.
const pageFooterLines = [
  /^[A-Z]{1,3} \d{1,4}-[A-Z]?\d{1,3} \d{1,2}\/\d{1,2}\/\d{2}$/,
  // The title alone (pdftotext), or the title and the page number on one line (PDF.js).
  /^Proposed Amendments to (?:[A-Z]-Eng\. )?[A-Z]{1,3} \d{1,4}(?: \([^)]{1,20}\))?(?: Page \d{1,3})?$/,
  /^Page \d{1,3}$/,
  // A Version's page number, and the measure at the head of its page.
  /^\[\d{1,3}\]$/,
  /^(?:MR )?(?:[A-Z]-Eng\. )?(?:HB|SB|HJR|SJR|HCR|SCR|HJM|SJM|HM|SM|HR|SR) \d{1,4}$/,
  // A Version's first page.
  /^NOTE: Matter in boldfaced type in an amended section is new; matter \[italic and bracketed\] is existing law to be omitted\.$/,
  /^New sections are in boldfaced type\.$/,
  // The LC number of a Version's first page, or a printed amendment's ("LC 290/SB 1570-5", "LC 146/SB 1501-A13").
  /^LC \d{1,5}(?:\/[A-Z]{1,3} \d{1,4}-[A-Z]{0,2}\d{1,3})?$/,
  /^Enrolled .{1,80} \([A-Z]{1,3} \d{1,4}-[A-Z]{1,5}\) Page \d{1,3}$/,
  /^[HS](?:MR)?A to (?:[A-Z]-Eng\. )?[A-Z]{1,3} \d{1,4} Page \d{1,3}$/,
];

/**
 * Turns extracted text, from `pdftotext` or from PDF.js, into running text. Both put each line
 * number on a line of its own and break words with a hyphen at the end of a line, and a page
 * adds its header and footer (in the form of either extractor), so all three go. Everything else is kept as printed.
 */
export function normalizeExtractedText(text: string): string {
  const lines = text
    .split(/[\n\f]/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^\d{1,2}$/.test(line) && !pageFooterLines.some((footer) => footer.test(line)));
  return lines
    .join("\n")
    .replace(/([a-z])-\n([a-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}
