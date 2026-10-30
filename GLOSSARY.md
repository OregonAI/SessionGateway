# SessionGateway

A cited, searchable copy of one Oregon legislative session for AI agents, paired with the OregonAI Corpus platform to show how measures affect state agencies.

## Language

### Sessions

**Session**:
One Oregon legislative session as OLIS keys it: `2025R1` (regular), `2025S1` (special), `2025I1` (interim).
_Avoid_: biennium, term

**Live Session**:
The Session currently meeting, whose measures, documents and votes change during the day.

### The index

**Index**:
Everything a deployment holds of its Session, pulled from OLIS.

**Full pull**:
A pass that reads every row of the Session from the OLIS feed. It counts as complete only when every set's rows match the feed's own count (ADR-0005).

**Document**:
One file OLIS links (a Version, a Printed Amendment, a posting of a Proposed Amendment, an analysis document, an Exhibit, a Recording Log, Testimony or an agenda), fetched once and kept with its extracted text, `source_url`, retrieval time and content hash.
_Avoid_: attachment, file, when the text is meant

**Part**:
One slice of a Document's text, at most 20,000 characters and ending at the end of a line, so a long Document is read a Part at a time. The Parts joined are the text exactly.
_Avoid_: page, chunk (which search will mean)

**Text layer**:
The text a PDF carries, as opposed to a picture of text. A scan or a photograph has none, and its Document is flagged.
_Avoid_: OCR, which reads a picture and is out of scope

**Build report**:
What the ingest worker writes after a full pull, beside the database (spec #1, story 54): `build-report.json`, the Documents with no Text layer and the Documents it could not get or read, and `unresolved-legislator-codes.json`, the Unresolved Legislator Codes.

**As of**:
When the Index was last refreshed from OLIS: the moment the latest completed full pull began, shown in Pacific time with its UTC offset. Every result carries it.

**Live status**:
A Measure's Location, History, Schedule and Votes as OLIS says them when a `get_measure` call arrives, in the result's `live_status` block beside what the Index last pulled. It is dated by the clock at the read, and the Index's As of time dates the rest of the result. The lookup asks OLIS five questions about that one Measure and never pulls a set (ADR-0005; `docs/adr/0014-get-measure-reads-one-measure-from-olis-and-falls-back-to-the-cache.md` lists them), and gives up after a bound (5 seconds unless the deployment sets `OLIS_LIVE_TIMEOUT_MS`). If it fails (an error status, a broken connection, no answer within the bound, a page the client cannot read, a Measure OLIS does not list), the block holds the Index's values instead, is dated by the As of time, says in its `notice` that the lookup failed and why, and has no Schedule. That is a normal result, not an error: the cache still answers.
_Avoid_: status, unqualified; live data

### Measures and their texts

**Measure**:
A bill, joint resolution, concurrent resolution, memorial or resolution in one Session, identified by Session, prefix and number (HB 3318 in 2025R1).
_Avoid_: bill, when resolutions and memorials are included

**Catchline**:
A Measure's one-sentence statement of what it does, as the feed's `CatchLine` gives it.
_Avoid_: title, summary

**Digest**:
The text OLIS publishes about what a Measure does, from the feed's `MeasureSummary`: a line headed "Digest:" and a line for each provision, served as published with OLIS's markup (`<b>` for new text, `[<i>...</i>]` for text deleted from the prior Version).
_Avoid_: summary, abstract

**Citation**:
A Measure written the way people say it, such as "SB 69". The Session is the deployment's.
_Avoid_: bill number

**Measure id**:
A Measure's id in OregonAI's form, such as `measure-2025r1-sb69`, which an agent can take to OregonAI.
_Avoid_: key, slug

**Version**:
One printed text of a Measure with every adopted amendment folded in: Introduced, A-Engrossed, B-Engrossed and so on, through Enrolled.
_Avoid_: draft, revision

**Proposed Amendment**:
A committee's draft change to a Version, numbered like SB 69-1 or -A3 and posted for a meeting. A bare "amendment" means this.

**Posting**:
One appearance of a Proposed Amendment at a committee meeting, with the file posted there and what the committee did with it (Proposed, Adopted, ...). A Proposed Amendment is one node however many Postings it has, and each Posting is a Document.
_Avoid_: version of an amendment

**Printed Amendment**:
The printed text of amendments a chamber adopted, such as "House Amendments to Introduced".
_Avoid_: amendment, unqualified

**Testimony**:
A document a person or organization submitted to a committee on a Measure or topic.
_Avoid_: comment, letter

**Exhibit**:
A document posted to a committee meeting's record, other than Testimony: meeting materials, presentations, witness-registration lists.
_Avoid_: meeting document, attachment

**Committee**:
A House, Senate or joint committee of one Session, by the code the feed gives it (`SLB`).

**Meeting**:
One sitting of a Committee, identified by the Committee and its start time in Pacific time (`meeting-2025r1-slb-2025-01-30-0800`).

**Agenda**:
A Meeting's published agenda, a Document of its own.

**Agenda item**:
One line of a Meeting's agenda: a Measure the Committee takes up (a Public Hearing, a Work Session, or both) or another item, such as an executive appointment. The feed's `CommitteeAgendaItems` rows give them, each with its committee, meeting time and kind of meeting, and the Action says what the Committee did with each. The feed's property for the committee is `CommitteCode`; the OLIS client hands it on as the committee's code. An item about no Measure is not a Measure's Schedule (`docs/research/olis-live.md` §2).
_Avoid_: agenda entry

**Meeting status**:
What the feed's `MeetingStatus` says of a Meeting: Scheduled, Cancelled or No Meeting Scheduled. It is shown as the feed writes it.

**Recording Log**:
A committee's timecoded index of one meeting's recording: agenda items, motions, votes and each speaker.
_Avoid_: minutes

**Fiscal Impact Statement**:
The Legislative Fiscal Office's statement of what a Version would cost government, naming the Agencies affected under "Government Unit(s) Affected".
_Avoid_: fiscal note

**Location**:
Where a Measure is now, as the feed's `CurrentLocation` says it ("In Senate Committee", "Chapter Number Assigned", "House Desk - Vetoed"), with the committee code the feed gives beside it (`CurrentCommitteeCode`, such as `JWM`). The code is the feed's field as it stands, not a statement that the Measure is in that committee: the cache has it set on some Measures whose Location says they are at the President's desk, and null on one in a House committee (`docs/research/olis-votes.md` §6). `get_measure` shows what the last full pull stored, dated by the As of time, and the Live status shows what OLIS says now.
_Avoid_: status, which names that live block

**History**:
What happened to a Measure, one line for each row of the feed's MeasureHistoryActions: the chamber, when the action happened (Pacific time with its offset) and the text as OLIS prints it. `get_measure` lists it oldest first, as OLIS does, so the last line is the latest action.

**Schedule**:
A Measure's upcoming committee meetings: the Agenda items of the Measure whose meeting is at or after the time of the read, soonest first. Only the Live status has one: a Live status that fell back to the cache has none (`null`, not an empty list: an empty list says OLIS has nothing ahead). The Index holds the agenda items of its last full pull, which `meetings` serves, but the fallback does not read a Schedule from them.

**Analysis document**:
A Fiscal Impact Statement, revenue impact statement, Staff Measure Summary or Budget Report that the feed ties to a Measure, with a Version label. `get_measure` lists them by Version.
_Avoid_: fiscal document, report, unqualified

**Version label**:
The feed's own mark of the Version an analysis document is of: "INTRO", "A", "B", "C", or one the feed does not define ("B*", "MRA", blank). "INTRO" and a single letter name a Version; the others do not, and neither does any label on a document the feed flags as a minority report's (`IsMinority`). Such a document is listed as unmapped with the reason (ADR-0013).
_Avoid_: version, unqualified

### People

**Legislator**:
One member of the Legislative Assembly, as a person, across every Legislator Code the feed uses for them. Its id is `legislator-2025r1-<name>`, where `<name>` is the last name in lower case plus the initials the code carries after it, joined by hyphens: `legislator-2025r1-fahey` for "Rep Speaker Fahey", `legislator-2025r1-smith-db` for "Sen Smith DB", `legislator-2025r1-levy-b` for "Rep Levy B". The chamber word and an office title ("Speaker", "President") are left out, so the id stays with the person when their code changes chamber or office. When the alias file joins two codes of one person, the id is the one the alias file's code makes: `legislator-2025r1-neron` for "Rep Neron", who is also "Sen Neron Misslin", so the id is the same whether the feed lists the old code, the new one or both.

**Legislator Code**:
The display string the feed uses for a Legislator in votes and sponsorships ("Rep Helm", "Sen Smith DB"). It can change during a Session, and it can carry an office title ("Rep Speaker Fahey"). A code with a row in the feed's Legislators set is that row's Legislator; a code with none is looked up in the alias file.
_Avoid_: legislator id

**Alias file**:
The small file, kept by hand and committed with the code, that says who a Legislator Code without a Legislators row is: another code of the same person (for example one from before they changed chamber, which joins the two even if the feed still lists both), or a person the Legislators rows do not list. Each entry cites its evidence from the feed itself. A code the feed gives no evidence for is left out of the file, not guessed.

**Unresolved Legislator Code**:
A Legislator Code that has no Legislators row and no alias-file entry. The ingest worker lists each one after a full pull, with how many rows of each entity set used it, so that the operator can fix the alias file.

**Sponsor**:
A Legislator named on a Measure's MeasureSponsors row, chief or regular, shown in print order: by the row's PrintOrder, then, among the sponsors who share one, the Measure's own chamber before the other, then by name, as OLIS prints them. A sponsor added after introduction stands in their printed place, not at the end. Committee and presession rows name no Legislator and are not Sponsors; `get_measure` shows them beside the Sponsors, as the Committee sponsors and the Presession messages.
_Avoid_: author

**Committee sponsor**:
A committee that sponsors a Measure, from a MeasureSponsors row of type Committee ("Sponsored by COMMITTEE ON EDUCATION"). `get_measure` names it by the committee's code in the feed, such as `SED`; its name waits for the ticket that reads Committees. It is not a Sponsor.

**Presession message**:
The text of a MeasureSponsors row of type Presession, as OLIS publishes it: "(Presession filed.)", or for SB 69 the Senate Interim Rule 213.28 notice its document opens with. A Measure can have none, one or (13 in 2025R1) two. The row names no Legislator.

**Vote**:
One Legislator's answer in a floor vote or a committee vote, in the feed's own word. Committee votes have "Aye", "Nay" and "Excused"; floor votes add "Excused for Business" and "Absent" (`docs/research/olis-votes.md` §2 has the counts). The voter is named by a Legislator Code, so it resolves to a Legislator like a Sponsor does.

**Floor vote**:
One chamber's roll call on a Measure, taken at one action of its History: the feed's MeasureVotes rows that share a `MeasureHistoryId`, with the chamber, when it voted and the action's text ("Third reading.  Carried by Bonham.  Passed."). `get_measure` lists a Measure's floor votes in the order they were taken, each with every Legislator's Vote in the order of the feed's ids for the entries. In the cache that is the order the feed lists them in (`docs/research/olis-votes.md` §5).
_Avoid_: roll call, when the chamber matters

**Committee vote**:
One committee's roll call on a Measure at one meeting: the feed's CommitteeVotes rows that share a `CommitteeReportId`, with the committee's code and when it met. The feed gives some rolls under two reports with the same rows in each (in the cache, always a joint or conference committee's: `docs/research/olis-votes.md` §3), and `get_measure` lists such a roll once. The feed creates the rows before the meeting (§4), so a committee vote's meeting can be later than the As of time, with answers already listed; the feed does not say whether the vote has been taken. Committee names wait for the ticket that reads Committees, as for the Committee sponsor.

### Statutes and agencies

**Statute Link**:
A connection from a Version or Proposed Amendment to an ORS section or chapter, of one kind: amends, repeals, adds to, or cites.
_Avoid_: reference, citation, when the kind matters

**Measure section**:
A numbered section of a Version or Proposed Amendment, printed "SECTION 8." and written "§8" (or "§21a" for one inserted later). A Statute Link names the measure section it is read in.
_Avoid_: section, unqualified (an ORS section is another thing)

**Relating clause**:
The words of a Measure's text that say what it does to the statutes: "Relating to human services; amending ORS 409.711." They start on line 2 of page 1 and can run over several lines (SB 69's A-Engrossed Version has three). A Proposed Amendment can edit them.
_Avoid_: title

**Statutes Affected Table**:
Legislative Counsel's official table of the ORS sections each Measure amends, repeals or adds to, published after the Session ("artables").

**Agency**:
A state government unit as the OregonAI agency registry names it.
_Avoid_: department, issuing body

**Agency Link**:
A connection from a Measure, Version or Proposed Amendment to an Agency, of one kind: named in a Fiscal Impact Statement, named in the text, submitted Testimony, or derived through a Statute Link.
_Avoid_: affected agency, unqualified

**Snapshot**:
The slice of OregonAI's data copied at build time, from a checkout of its executive-regulatory-frameworks repository: the agency registry, the list of ORS section ids and the Chapter table. It is named by the commit it was read from and the commit's date, which `session_overview` reports. Nothing looks it up again while serving (ADR-0004, ADR-0012).
_Avoid_: cache, mirror

**Chapter table**:
The Snapshot's table from an ORS chapter to the Agencies whose rules implement its sections, found from the rules' links to ORS sections and each rule's OAR chapter. It is how a Statute Link to a chapter reaches an Agency.
_Avoid_: statute-to-agency map
