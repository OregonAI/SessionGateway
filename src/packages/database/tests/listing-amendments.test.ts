// Seam 4 (test/CLAUDE.md): a Proposed Amendment's Listing follows its Postings (ADR-0030, glossary "Listing"): it is
// listed while the feed lists any Posting, and No longer listed when it lists none. Each case has a database of its own.
// Every value is MADE UP (made-up-index.ts): SB 9001-1, posted to two meetings of a made-up committee.
import { afterEach, describe, expect, it } from "vitest";
import {
  amendmentId,
  asOf,
  committee,
  meetingOn,
  openMadeUpIndex,
  postingLink,
  pullOf,
  session,
  storeMadeUpDocument,
  type MadeUpIndex,
} from "./made-up-index.ts";

let index: MadeUpIndex;
afterEach(() => {
  index.close();
});

const first = postingLink(1, 10);
const second = postingLink(2, 11);
const meetings = [meetingOn(10), meetingOn(11)];

/** A complete pull that reads the committee, its two meetings and these postings. */
function pullListing(...postings: (typeof first)[]): ReturnType<typeof pullOf> {
  return pullOf({ Committees: [committee], CommitteeMeetings: meetings, CommitteeProposedAmendments: postings });
}

describe("a Proposed Amendment", () => {
  it("is listed while any of its Postings is, and No longer listed once none is, with the latest listing of any Posting", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullListing(first, second));
    storeMadeUpDocument(index, first, "Page 1. Insert a made-up thing.");
    storeMadeUpDocument(index, second, "Page 1. Insert a made-up thing, again.");
    expect(index.reader.findDocument(amendmentId)?.listing).toEqual({ listed: true, lastListedAt: asOf(1) });

    // The feed stops listing the first Posting; the second is still listed, so the amendment is.
    index.writer.recordFullPull(session, asOf(2), pullListing(second));
    index.writer.recordFullPull(session, asOf(3), pullListing(second));
    expect(index.reader.findDocument(first.id)?.listing).toEqual({ listed: false, lastListedAt: asOf(1) });
    expect(index.reader.findDocument(second.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(3) });
    expect(index.reader.findDocument(amendmentId)?.listing).toEqual({ listed: true, lastListedAt: asOf(3) });

    // Two complete pulls list neither: the amendment is No longer listed, last listed by the latest pull that listed a Posting.
    index.writer.recordFullPull(session, asOf(4), pullListing());
    index.writer.recordFullPull(session, asOf(5), pullListing());
    expect(index.reader.findDocument(amendmentId)?.listing).toEqual({ listed: false, lastListedAt: asOf(3) });

    // A pull that lists one Posting again lists the amendment.
    index.writer.recordFullPull(session, asOf(6), pullListing(first));
    expect(index.reader.findDocument(amendmentId)?.listing).toEqual({ listed: true, lastListedAt: asOf(6) });
  });

  it("is listed while the feed lists a Posting whose file the index does not hold", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullListing(first, second));
    // Only the first Posting's file was fetched; the feed lists the second without it.
    storeMadeUpDocument(index, first, "Page 1. Insert a made-up thing.");
    index.writer.recordFullPull(session, asOf(2), pullListing(second));
    index.writer.recordFullPull(session, asOf(3), pullListing(second));
    expect(index.reader.findDocument(first.id)?.listing).toEqual({ listed: false, lastListedAt: asOf(1) });
    expect(index.reader.findDocument(amendmentId)?.listing).toEqual({ listed: true, lastListedAt: asOf(3) });
  });
});
