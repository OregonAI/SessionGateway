import { createHash } from "node:crypto";
import type { IndexWriter } from "#/packages/database/writer.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { OrsSectionId } from "#/packages/domain/oregonai.ts";
import type { Download } from "#/packages/olis-client/index.ts";
import { extractPdfText } from "#/packages/pdf-text/index.ts";
import { parseStatutesAffectedTable, type StatutesAffectedTableParse } from "#/packages/statute-links/index.ts";
import { tallyLoneEEntries } from "#/packages/statute-links/table.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * What a full pull did about Legislative Counsel's Statutes Affected Table, for the build report (ADR-0034).
 * `outcome` says what happened to the copy this pull fetched; `held` says whether the index holds a table after the
 * pull, which it can when this pull got nothing, because a copy that was loaded once is kept.
 */
export type StatutesAffectedTableReport = {
  source_url: string;
  outcome:
    | "loaded" // new bytes were read and stored, or the held bytes again with another snapshot (ADR-0044)
    | "unchanged" // the bytes and the snapshot are the ones the index holds the table with, so nothing was read again
    | "read_again_from_held_copy" // the table could not be fetched and the snapshot changed: the held text was read again
    | "not_published" // the server answered 404: the table does not exist yet, or no longer
    | "not_fetched" // any other failure to get the bytes
    | "not_read" // got bytes that are not a table the parser reads
    | "refused_unchanged"; // the bytes are the ones an earlier pull refused as no table, so nothing was read again
  held: boolean;
  /**
   * For "loaded" and "read_again_from_held_copy", and for "not_read" and "refused_unchanged" when a table is held and
   * the snapshot changed, so that the held copy was read again (ADR-0044): the entries read, the rows of a previous Session's Measures (repassed
   * over the Governor's veto, “OVP”) kept apart from them, and the lines of the ORS table the parser could not read.
   */
  entries?: number;
  previous_session_entries?: number;
  unread_lines?: number;
  /**
   * For "loaded" and "read_again_from_held_copy": how many of the entries end in an E alone after the Measure number,
   * which is the emergency clause or an E-Engrossed level and the table's text does not say which (ADR-0033), and how many of those name a Measure of which the
   * feed lists an E-Engrossed Version in this pull. The rest are read as the emergency clause of the Introduced Version when
   * get_measure shows their Measure (an entry of a Measure the index does not hold is shown nowhere). The Versions the feed
   * lists change between pulls and the table need not, so the second count is of the pull that loaded the table; get_measure
   * reads the Versions as of the last pull.
   */
  lone_e_entries?: number;
  lone_e_with_e_engrossed_version?: number;
  /**
   * For "not_fetched", "not_read" and "refused_unchanged": why. For "read_again_from_held_copy": why the table could not
   * be fetched.
   */
  reason?: string;
};

type ReadArguments = {
  /** The address the deployment names, as the configuration gives it. */
  url: string;
  /** What the pull got when it fetched that address: the bytes, or why there are none. */
  download: Download;
  /** The time of the fetch, for the copy's retrieval time. */
  retrievedAt: Timestamp;
  writer: IndexWriter;
  session: SessionKey;
  /** The snapshot's ORS section list, which a series in the table is expanded against. */
  orsSections: readonly OrsSectionId[];
  /**
   * The commit of that snapshot: a held table read with another commit is read again, though its bytes are the same
   * (ADR-0044).
   */
  snapshotCommit: string;
};

/**
 * Reads the Statutes Affected Table the pull fetched and, when its bytes differ from the copy the index holds or the copy
 * was read with another snapshot, reads and stores it (ADR-0034, ADR-0044). Nothing that goes wrong with the table stops
 * the pull or changes the copy the index holds: a table that is not published yet, a failed fetch and a file that is not a
 * table all leave it as it was. When the fetch fails, or gives bytes refused as no table, and the snapshot changed, the held
 * copy's text is read again with the new section list (ADR-0044). A failure of the PDF extractor itself is a bug and throws,
 * as it does for a document.
 */
export async function readStatutesAffectedTable(read: ReadArguments): Promise<StatutesAffectedTableReport> {
  const heldTable = read.writer.heldStatutesAffectedTable(read.session);
  const held = heldTable !== undefined;
  const readWithThisSnapshot = heldTable?.snapshotCommit === read.snapshotCommit;
  const report = { source_url: read.url };
  // The series follow the snapshot: the held bytes are read again from the stored text with the new section list, and
  // the copy (its bytes, hash, address and retrieval time) stays as it was (ADR-0044).
  const readHeldAgain = (text: string): StatutesAffectedTableParse => {
    const parsed = parseStatutesAffectedTable({ text, orsSections: read.orsSections });
    read.writer.rereadStatutesAffectedTable(read.session, {
      entries: parsed.entries,
      snapshotCommit: read.snapshotCommit,
    });
    return parsed;
  };
  const download = read.download;
  if (download.kind === "failed") {
    const reason = download.status === 404 ? "The server answered 404" : download.reason;
    if (heldTable !== undefined && !readWithThisSnapshot) {
      const parsed = readHeldAgain(heldTable.text);
      return { ...report, outcome: "read_again_from_held_copy", held: true, ...countsOf(read, parsed), reason };
    }
    return download.status === 404
      ? { ...report, outcome: "not_published", held }
      : { ...report, outcome: "not_fetched", held, reason };
  }
  const contentHash = createHash("sha256").update(download.bytes).digest("hex");
  if (contentHash === heldTable?.contentHash) {
    if (readWithThisSnapshot) return { ...report, outcome: "unchanged", held: true };
    // The same bytes with another snapshot: their stored text is what extracting them again would give.
    return { ...report, outcome: "loaded", held: true, ...countsOf(read, readHeldAgain(heldTable.text)) };
  }
  // Refused bytes replace nothing, so the refusal is reported as ever; with another snapshot, the held copy is read
  // again from its stored text, as when the fetch fails, and its counts are given beside the refusal (ADR-0044).
  const heldReadAgain = () =>
    heldTable !== undefined && !readWithThisSnapshot ? countsOf(read, readHeldAgain(heldTable.text)) : {};
  const refused = read.writer.refusedStatutesAffectedTable(read.session);
  if (contentHash === refused?.contentHash) {
    return { ...report, outcome: "refused_unchanged", held, reason: refused.reason, ...heldReadAgain() };
  }
  // Bytes that are no table are remembered by their hash, so that a server that keeps giving the same placeholder or scan
  // does not have it extracted again at every pull.
  const refuse = (reason: string): StatutesAffectedTableReport => {
    read.writer.refuseStatutesAffectedTable(read.session, { contentHash, reason });
    return { ...report, outcome: "not_read", held, reason, ...heldReadAgain() };
  };
  const extraction = await extractTableText(read.url, download.bytes);
  if (extraction.kind === "unreadable") return refuse(extraction.reason);
  if (!extraction.pdf.hasTextLayer) return refuse("The file has no text layer (a scan or a photograph)");
  const parsed = parseStatutesAffectedTable({ text: extraction.pdf.text, orsSections: read.orsSections });
  if (parsed.entries.length === 0) return refuse("The text holds no row of an ORS table");
  read.writer.storeStatutesAffectedTable(read.session, {
    sourceUrl: read.url,
    retrievedAt: read.retrievedAt,
    contentHash,
    pageCount: extraction.pdf.pageCount,
    text: extraction.pdf.text,
    entries: parsed.entries,
    snapshotCommit: read.snapshotCommit,
  });
  return { ...report, outcome: "loaded", held: true, ...countsOf(read, parsed) };
}

/** What the build report counts of a table that was read (ADR-0034, ADR-0033). */
function countsOf(
  read: ReadArguments,
  parsed: StatutesAffectedTableParse,
): Pick<
  StatutesAffectedTableReport,
  "entries" | "previous_session_entries" | "unread_lines" | "lone_e_entries" | "lone_e_with_e_engrossed_version"
> {
  // The rule that sets a lone-E entry beside a Version is the entry point's, so this count and get_measure cannot disagree.
  const loneE = tallyLoneEEntries(parsed.entries, read.session, (description) =>
    read.writer.measuresListingVersion(read.session, description),
  );
  return {
    entries: parsed.entries.length,
    previous_session_entries: parsed.previousSessionEntries.length,
    unread_lines: parsed.unreadLines.length,
    lone_e_entries: loneE.entries,
    lone_e_with_e_engrossed_version: loneE.namingNoVersion,
  };
}

async function extractTableText(url: string, bytes: Uint8Array): ReturnType<typeof extractPdfText> {
  try {
    return await extractPdfText(bytes);
  } catch (error) {
    throw new Error(`The PDF extractor failed on the Statutes Affected Table (${url})`, { cause: error });
  }
}
