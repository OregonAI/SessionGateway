// Reading a stored file for Statute Links (spec #1, module 4; ADR-0015): which call of the parser a file takes, by what the
// file is read as. The parser is `statute-links`; this is only what the worker does with it.
import type { StatuteParseRecord, UnreadStatuteFile } from "#/packages/database/writer.ts";
import type { OrsSectionId } from "#/packages/domain/oregonai.ts";
import { unreadStatuteParse } from "#/packages/domain/statute-links.ts";
import {
  parseStatuteLinks,
  readAmendedVersionHeader,
  STATUTE_LINK_PARSER_VERSION,
} from "#/packages/statute-links/index.ts";

/**
 * What reading one stored file for Statute Links comes to (ADR-0015): the links of a Version, or of a
 * Proposed Amendment's inserted sections with its relating clause edits and the Version its header names. A
 * file with no text layer gives no links and is recorded as not read.
 */
export function statuteParseOf(
  file: UnreadStatuteFile,
  stored: { text: string; hasTextLayer: boolean },
  orsSections: readonly OrsSectionId[],
): StatuteParseRecord {
  const common = {
    contentHash: file.contentHash,
    readAs: file.readAs,
    parserVersion: STATUTE_LINK_PARSER_VERSION,
  };
  if (!stored.hasTextLayer) {
    return { ...common, ...unreadStatuteParse() };
  }
  switch (file.readAs) {
    case "version": {
      const parsed = parseStatuteLinks({ documentKind: "version", text: stored.text, orsSections });
      return {
        ...common,
        textRead: true,
        amendedVersionHeader: null,
        links: parsed.links,
        relatingClauseEdits: parsed.relatingClauseEdits,
      };
    }
    case "proposed_amendment": {
      const parsed = parseStatuteLinks({ documentKind: "proposed-amendment", text: stored.text, orsSections });
      return {
        ...common,
        textRead: true,
        amendedVersionHeader: readAmendedVersionHeader(stored.text) ?? null,
        links: parsed.links,
        relatingClauseEdits: parsed.relatingClauseEdits,
      };
    }
    default:
      return file.readAs satisfies never;
  }
}
