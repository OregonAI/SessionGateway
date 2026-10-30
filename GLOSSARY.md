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
The file the ingest worker writes after a full pull, beside the database: the Documents with no Text layer and the Documents it could not get or read.

**As of**:
When the Index was last refreshed from OLIS: the moment the latest completed full pull began, shown in Pacific time with its UTC offset. Every result carries it.

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

**Recording Log**:
A committee's timecoded index of one meeting's recording: agenda items, motions, votes and each speaker.
_Avoid_: minutes

**Fiscal Impact Statement**:
The Legislative Fiscal Office's statement of what a Version would cost government, naming the Agencies affected under "Government Unit(s) Affected".
_Avoid_: fiscal note

**Analysis document**:
A Fiscal Impact Statement, revenue impact statement, Staff Measure Summary or Budget Report that the feed ties to a Measure, with a Version label. `get_measure` lists them by Version.
_Avoid_: fiscal document, report, unqualified

**Version label**:
The feed's own mark of the Version an analysis document is of: "INTRO", "A", "B", "C", or one the feed does not define ("B*", "MRA", blank). "INTRO" and a single letter name a Version; the others do not, and neither does any label on a document the feed flags as a minority report's (`IsMinority`). Such a document is listed as unmapped with the reason (ADR-0012).
_Avoid_: version, unqualified

### People

**Legislator**:
One member of the Legislative Assembly, as a person, across every Legislator Code the feed uses for them.

**Legislator Code**:
The display string the feed uses for a Legislator in votes and sponsorships ("Rep Helm", "Sen Smith DB"). It can change during a Session.
_Avoid_: legislator id

### Statutes and agencies

**Statute Link**:
A connection from a Version or Proposed Amendment to an ORS section or chapter, of one kind: amends, repeals, adds to, or cites.
_Avoid_: reference, citation, when the kind matters

**Statutes Affected Table**:
Legislative Counsel's official table of the ORS sections each Measure amends, repeals or adds to, published after the Session ("artables").

**Agency**:
A state government unit as the OregonAI agency registry names it.
_Avoid_: department, issuing body

**Agency Link**:
A connection from a Measure, Version or Proposed Amendment to an Agency, of one kind: named in a Fiscal Impact Statement, named in the text, submitted Testimony, or derived through a Statute Link.
_Avoid_: affected agency, unqualified
