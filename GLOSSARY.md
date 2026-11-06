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

**Pull**:
One read of the Session's feed into the Index: a Full pull or an Increment.
_Avoid_: run (the nightly Hash sample is a run too), pass, sync

**Full pull**:
A pass that reads every row of the Session from the OLIS feed. It counts as complete only when every set's rows match the feed's own count (ADR-0005). A pull that is short of any count is refused whole: it stores nothing, the Index stays as the last complete pull left it, and the Build report says which sets were short (ADR-0030).

**Increment**:
A pass that reads the rows OLIS created or modified since a time two hours before the last run began (`CreatedDate gt X or ModifiedDate gt X`) for most sets, Legislators and Committees whole, FloorLetters by `FloorLetterId` above the highest held (the whole set while none is held), and ConveneTimes and LegislativeSessions not at all. It stores them, and fetches the documents they link that the Index does not hold. It is not a complete pull: it lists nothing and never marks a row no longer listed. It moves the Index's as-of time, and `session_overview` reports when the last one ran. A change to an existing row of MeasureDocuments or MeasureAnalysisDocuments, whose `ModifiedDate` is always null, waits for the next Full pull (ADR-0039, ADR-0042, ADR-0045).

**Meeting day**:
A day the Session meets: a day with a committee meeting or a floor convening (ConveneTimes) scheduled, or any weekday while the Session is in progress. The `15min` increments run on meeting days only (ADR-0039). The Session is in progress from its LegislativeSessions `BeginDate` to its `EndDate`, both included. While the feed gives no `EndDate`, it is in progress from `BeginDate` to the later of `BeginDate` and the last convening the Index holds, both included, and on `BeginDate` only while it holds none (ADR-0043). A full pull reads the convenings and that row (ADR-0042).

**Staleness warning**:
The block of text added to every tool result when the Index's latest update is too old for the configured rhythm: over two hours old during working hours (`15min`), older than the last night window (`daily`), or a full pull older than the last scheduled one (`off`) (ADR-0039).

**No longer listed**:
Said of a row the Index keeps when two complete Full pulls in a row did not list it. The row leaves search results, stays served by id (`get_document` says `no_longer_listed` and when the feed last listed it), and stays in the lists of the other tools, flagged `no_longer_listed`. A row that one complete pull misses is still listed, a pull that was refused counts for nothing, and a row that a later complete pull lists is listed again. A row no complete pull has listed (an old file's, or one an increment stored) is read as listed, not yet checked: `get_document` gives it `last_listed_at: null`. An Agency Link whose every evidence Document is no longer listed is flagged the same way, and search's Agency filter no longer counts it (ADR-0037). Nothing is deleted (ADR-0005, ADR-0030).
_Avoid_: deleted, withdrawn, removed (OLIS says none of these: a row stops being listed)

**Listing**:
Whether the feed still lists a row the Index keeps, and when a complete Full pull last listed it: listed, No longer listed, or listed and not yet checked by any complete Full pull. A Proposed Amendment's Listing follows its Postings, and an Agency Link's its evidence Documents (ADR-0037).
_Avoid_: status

**Committee member**:
A row of the feed's CommitteeMembers: a Legislator Code, a title ("Chair", "Co-Chair", "Member") and a Committee. The set's declared key (committee, date created, title) is not unique, so a row is told apart by all its properties, and Rep Helm and Rep Owens, Co-Chairs of HALNRW from one instant, are two rows. A task force's members are not all Legislators, so the code is stored as written, and one that names no Legislators row is an Unresolved Legislator Code, not an error. No tool shows the set yet; the Build report lists each committee's rows by Legislator Code.

**Document**:
One file OLIS links (a Version, a Printed Amendment, a posting of a Proposed Amendment, an analysis document, an Exhibit, a Recording Log, Testimony or an agenda), fetched once and kept with its extracted text, `source_url`, retrieval time and content hash.
_Avoid_: attachment, file, when the text is meant

**Part**:
One slice of a Document's text, at most 20,000 characters and ending at the end of a line, so a long Document is read a Part at a time. The Parts joined are the text exactly.
_Avoid_: page, chunk (search's word is Passage)

**Text layer**:
The text a PDF carries, as opposed to a picture of text. A scan or a photograph has none, and its Document is flagged.
_Avoid_: OCR, which reads a picture and is out of scope

**Hash sample**:
The documents the worker fetches again each night (about 200, `INGEST_HASH_SAMPLE_SIZE`) to compare their hashes with the stored ones, so that a file replaced behind the same URL is noticed. It runs every night inside 5 pm to 6 am Pacific, outside the Full pull's hours. A file whose hash differs is a Hash mismatch: it is reported, in `hash-sample-report.json` beside the database, until a later night compares that document and finds the stored file again, and the stored document is not replaced. A document OLIS would not give is reported as not checked, not as a mismatch (ADR-0040).

**Build report**:
What the ingest worker writes after a full pull, beside the database (spec #1, story 54): `build-report.json`, the sets the pull read with the rows the feed counted, the rows that came and how many the Index lists (ADR-0030), the Documents with no Text layer, the Documents it could not get or read, and what it made of the Passages it stored (how many were embedded and how many reused, ADR-0025), what it made of the Statutes Affected Table when the deployment names one (ADR-0034), and `unresolved-legislator-codes.json`, the Unresolved Legislator Codes. For the Committee members it holds, the report lists each committee's rows by Legislator Code, with the unresolved ones. A refused pull writes a report of its own, with the sets and which were short.

**As of**:
When the Index was last refreshed from OLIS: the moment the latest complete Full pull, or a later Increment, began, shown in Pacific time with its UTC offset (ADR-0039). Every result carries it. Until the first Full pull completes the Index has none, and every tool answers with the same error saying so, whatever it was asked.

**Live status**:
A Measure's Location, History, Schedule and Votes as OLIS says them when a `get_measure` call arrives, in the result's `live_status` block beside what the Index last pulled. It is dated by the clock at the read, and the Index's As of time dates the rest of the result. The block says only what the top level does not: a Location, History or vote list that OLIS gives as the top level shows it is `unchanged`; a list that OLIS gives as the top level's entries with more after the last shows only those `new_entries`; any other difference is shown `full`, and replaces the top level's. The Schedule, which the top level has none of, is always shown (`docs/adr/0038-the-live-status-block-says-only-what-the-top-level-does-not.md`). The lookup asks OLIS five questions about that one Measure and never pulls a set (ADR-0005; `docs/adr/0014-get-measure-reads-one-measure-from-olis-and-falls-back-to-the-cache.md` lists them), and gives up after a bound (5 seconds unless the deployment sets `OLIS_LIVE_TIMEOUT_MS`). If it fails (an error status, a broken connection, no answer within the bound, a page the client cannot read, a Measure OLIS does not list), the block is dated by the As of time, says in its `notice` that the lookup failed and why, repeats none of the top level's values (each is `unchanged`, meaning the Index's), and has no Schedule. That is a normal result, not an error: the cache still answers.
_Avoid_: status, unqualified; live data

### Search

**Passage**:
One slice of a Document's text that search indexes and embeds: whole lines, at most 510 tokens by the embedding model's own count, with no overlap with the next. A Passage is a slice of the Document's text, so what a hit shows is exactly what the Document says (ADR-0025).
A Recording Log with a Speaker-turn index is cut around its turns (ADR-0053): each Speaker turn's lines are a Passage of their own, linked to the turn by its position, and the text between the turns is cut as any text is, so every line is in exactly one Passage.
_Avoid_: chunk, Part (a Part is what `get_document` serves)

**Hit**:
One result of `search`: a Document, or for a Proposed Amendment the amendment, with its id, kind, title, Measure, date, a snippet of the Passage that matched, its `source_url`, and how it was found (`found_by`). A Speaker turn of a Recording Log that matched is a Hit of its own (ADR-0053): the log's id, and a `turn` with the speaker, Meeting, Agenda item, Measure, timecode and Player link.
_Avoid_: result, match

**Exact citation**:
A Measure ("HB 3131"), a Proposed Amendment ("SB 69-2") or an ORS section ("ORS 468.130") written in a question as people write it. The Hits it names exactly come first: a Measure's Versions from Introduced to Enrolled, the amendment, the Documents whose text holds the section (ADR-0025). A citation that names nothing the index holds puts nothing first, and the result's `notes` name it.
_Avoid_: reference, Statute Link (a Statute Link is parsed from a Version's text, not found in a question)

**Keyword-only Document**:
An agenda, a Recording Log or a witness-registration list (an Exhibit the feed labels "Witness Registration", or titles so). Search finds it by its words and never by meaning: its Passages are not embedded. It is found by some of a question's words, after the Documents that hold them all. When OLIS relabels a stored Exhibit, the next pull moves it across.
_Avoid_: unembedded document

**Vector**:
The 384 numbers the embedding model gives a Passage's text, kept as 384 bytes (each number times 127, rounded) under the sha256 of the text and the model id. Identical text has one Vector, whichever Documents hold it.
_Avoid_: embedding, when the stored thing is meant

**Model id**:
The name of the embedding model, its revision, its pooling and the instruction a question carries, as one string. A Vector is valid only under the Model id that made it.

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

**Floor Letter**:
A letter sent to a chamber's floor, published as a FloorLetters row and a file: a Document that carries its row's Chamber, LetterDate, title and description, and the Measure it names when it names one. Its LetterDate is the only date it has, and an increment picks it up by its FloorLetterId (ADR-0045).
_Avoid_: floor document, letter, unqualified

**Position**:
Which side of a Measure a Testimony takes, from the feed's `PositionOnMeasureId`: 3983 support, 3982 oppose, 3981 neutral, 4022 unknown. Any other id is shown under its number and labelled "unlisted position", never dropped. `testimony` lists a Measure's Testimony by Position.
_Avoid_: stance, vote

**Organization**:
The feed's `Organization` of a Testimony row: free text typed by whoever submitted it, often a city ("Portland", "grants pass") and not an organization. `BehalfOf` is the other free-text field, and often names the real organization. Both are shown as written.

**Organization group**:
The Testimony of one Measure under one Position whose Organization matches after trimming, collapsing runs of white space and ignoring capitals ("Portland" and "PORTLAND"). It is shown by the spelling that comes first in CommTestId order, with every spelling it holds. The rows that give no Organization are one group, listed last.
_Avoid_: organization, unqualified

**Identical letters**:
Two or more Testimony rows of a Measure whose files have the same extracted text, exactly as stored, whatever their bytes. `testimony` lists the 10 largest sets, each once, as the id to read (the lowest CommTestId) and a count, and every item of a set, on any page, carries both. A file with no Text layer is never identical to another (ADR-0016).
_Avoid_: duplicates, form letters

**Exhibit**:
A document posted to a committee meeting's record, other than Testimony: meeting materials, presentations, witness-registration lists.
_Avoid_: meeting document, attachment

**Committee**:
A House, Senate or joint committee of one Session, by the code the feed gives it (`SLB`).

**Meeting**:
One sitting of a Committee, identified by the Committee and its start time in Pacific time (`meeting-2025r1-slb-2025-01-30-0800`).

**Agenda**:
A Meeting's published agenda, a Document of its own.

**Agenda revision**:
The `AgendaRevisionNumber` on a Meeting's row in the feed, which OLIS raises when the committee posts a changed agenda at the same address. The index keeps the revision each stored Agenda was fetched at; an Agenda is the one Document fetched again, when the row's revision is another one (ADR-0005, ADR-0041). Every other Document is treated as unchanging.

**Agenda item**:
One line of a Meeting's agenda: a Measure the Committee takes up (a Public Hearing, a Work Session, or both) or another item, such as an executive appointment. The feed's `CommitteeAgendaItems` rows give them, each with its committee, meeting time and kind of meeting, and the Action says what the Committee did with each. The feed's property for the committee is `CommitteCode`; the OLIS client hands it on as the committee's code. An item about no Measure is not a Measure's Schedule (`docs/research/olis-live.md` §2). In a Recording Log each line is decided on its own (ADR-0052): it is an Agenda item when it matches one of the Meeting's feed items (the measure id and its action, or the item's text), and the feed wins; otherwise the line's wording decides that line, except that a line shaped like a person ("Name, Title", or "Name - Organization" where the right side reads like an organisation or is "Self") is never taken by the wording. The parser says which way it found each.
_Avoid_: agenda entry

**Meeting status**:
What the feed's `MeetingStatus` says of a Meeting: Scheduled, Cancelled or No Meeting Scheduled. It is shown as the feed writes it.

**Recording Log**:
A committee's timecoded index of one meeting's recording: agenda items, motions, votes and each speaker.
_Avoid_: minutes

**Speaker turn**:
One timecoded line of a Recording Log that names who spoke: the speaker as logged (a name and title, a title that wraps onto a second line joined), the timecode, the offset in seconds the player link on that line gives, and the Agenda item the log has most recently named. The log's other timecoded lines (the call to order, an Agenda item, a motion, a vote, a recess, the adjournment) are entries, not turns. The parser reads the offset from the link, and from the timecode only for a page whose links it cannot match to the page's timecode lines.
_Avoid_: speech, statement

**Speaker-turn index**:
What the index holds of a Recording Log: its Event ID and each Speaker turn, with the speaker as logged, the Legislator Code and Legislator where the speaker resolved (among the Meeting's committee first, then among all the Session's Legislators, by title, chamber, surname and first name: ADR-0052), the Agenda item and its Measure (kept only when the index holds that Measure), the second on the recording's clock and the Player link. The worker reads it from the log's link annotations when it fetches the file. A log with no Event ID, or with two, has no index. A turn whose speaker does not resolve is kept with its text.
_Avoid_: transcript (the index holds no words that were spoken; the Transcript passages of ADR-0055 are a separate store, shown only while the Publication gate is on)

**Hearing**:
In `get_measure`, an Agenda item of a Recording Log with a Speaker-turn index that names the Measure, with the first Speaker turn under it and its Player link (ADR-0053; owner decision of 2026-11-05). A Public Hearing and a Work Session are each one, labelled by kind, and so is an item with other wording ("Informational Meeting"). An Agenda line that names several Measures ("SB 1542 and SB 1543 - Public Hearing") is a hearing of each, and lists them all; the turn keeps the first as its Measure. A log's hearings of a Measure come in the order of the recording.
_Avoid_: meeting (a Meeting may hold several hearings of a Measure, and one hearing may be of several Measures)

**Player link**:
The Legislature's own media player at a Speaker turn's second: the log's own player link (its address, `clientID` and Event ID) with the turn's `startStreamAt`. The service builds it from the log's link and never invents any part of it.
_Avoid_: video link, deep link

**Transcript**:
The machine transcript of one Meeting's recording, as the transcription tool writes it: the Event ID, the audio's SHA-256 and length, the model and its settings, when it was made, and Transcript segments. One file is one Meeting, and its format has a version that only increases (ADR-0054). It is not an official record.
_Avoid_: minutes, speaker-turn index (the index holds no words that were spoken)

**Transcript segment**:
One stretch of speech the model wrote as a unit: its start and end seconds, its text and its words, each with its own start and end. When the words of a segment fall in more than one Speaker turn, the read splits it at the word where the turn changes, and each piece is a passage of its own turn.
_Avoid_: utterance, caption

**Drift** (of a Speaker turn):
The distance in seconds from a Speaker turn's second to the nearest Transcript segment start. A turn over 10 seconds is flagged, and so is the Meeting when the median over its turns is over 10 seconds; the maximum is reported too (ADR-0054). It is a rough alarm: a segment start is not a speaker change.

**Transcript passage**:
One attached run of a Transcript's words: the words of a Transcript segment, or the piece of one between two speaker changes, cut to the Passage size, with its start and end seconds, a Player link at its first whole second, and whose words they are: a Speaker turn of a Recording Log (by its position), a procedural line of the log (a motion, its result, a vote, a roll call), or "speaker not given" (before the first turn, during a recess, after the meeting adjourned). It carries the Agenda item and Measure in force at its start. It keeps the quality numbers of its segment (`avg_logprob`, `compression_ratio`, `no_speech_prob`, `temperature`), which nothing filters by yet. The worker stores it and embeds it like Testimony; it is not a row of a document's text (ADR-0055). Search finds it, and the tools show it only while the Publication gate is on; `get_document` pages it with the Recording Log's text, so a part carries the passages of the turns in that part.
_Avoid_: caption, quote, utterance

**Machine-transcript notice**:
The sentence a result adds to the non-official notice when it holds a Transcript passage: "This result includes a machine transcript of the official recording, not an official record." The tool result envelope adds it, for each result, from `carriesTranscript` (ADR-0055).

**Publication gate**:
The server's `TRANSCRIPTS_PUBLISHED` setting (`true` or `false`, `false` when unset; any other value stops the start-up). While it is false no tool's answer holds any Transcript passage, and nothing is read from the transcript tables to answer; the worker ingests transcript files whatever it says. Turning it on is the owner's go-live decision for transcripts (spec #123, decision 23; ADR-0055). Stage-1 Speaker turns are never gated.
_Avoid_: feature flag, switch

**Transcript folder**:
The directory `TRANSCRIPTS_PATH` names, which holds the files `<eventId>.transcript.json` that `OregonAI/hearing-transcripts` writes. The worker reads it at the end of each pull. A file is read when it is new, its sha256 changed, or the turns it is attached to changed; a refused file is named in the Build report and what was stored before is kept. A transcript whose file has gone from the folder stays stored and served, and the Build report lists it (`file_no_longer_in_folder`).

**Event ID**:
The Invintus identifier of one recorded Meeting (such as `2025011038`), the `eventID` of the Legislature's player links in a Recording Log. A log with no player link has none, and a log whose links carry two different ones has two: the parser reports either and picks neither.
_Avoid_: video ID, recording ID

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
One chamber's roll call on a Measure, taken at one action of its History: the feed's MeasureVotes rows that share a `MeasureHistoryId`, with the chamber, when it voted and the action's text ("Third reading. Carried by Bonham. Passed."). `get_measure` lists a Measure's floor votes in the order they were taken, each with every Legislator's Vote in the order of the feed's ids for the entries. In the cache that is the order the feed lists them in (`docs/research/olis-votes.md` §5).
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

**Amended Version**:
The Version a Proposed Amendment amends. The amendment's own header names it, with the Measure it is to ("PROPOSED AMENDMENTS TO / SENATE BILL 69" is the Introduced Version of SB 69, "A-ENGROSSED HOUSE BILL 3795" the A-Engrossed Version of HB 3795) and so does the letter in its number, however the feed spells it ("-2", "2" and "- 2" are Introduced; "-A3" and "A3" are A-Engrossed). It is known only when the header, the number and the Measure agree and the Index holds that Version; otherwise it is not known, and nothing is guessed (ADR-0015).
_Avoid_: base Version, parent Version

**Superseded amendment**:
A Proposed Amendment whose Amended Version is not the latest the Index holds: it holds a later Version, whether or not it holds the Amended Version itself. `get_measure` leaves its Statute Links out and lists it apart, because the next Version's own links replace them (ADR-0001, ADR-0015); `compare_amendment` still answers for it.
_Avoid_: withdrawn, rejected (the committee's action on an amendment is its Meaning at each Posting)

**Same links as**:
Said of a Version whose Statute Links, as read from its text, repeat those of the Version before it in print order: under each kind the same targets, in the same measure sections and named in the same order. A Version whose text was not read has the same links as none, and none has the same links as it, because it has said nothing (ADR-0036).
_Avoid_: duplicate Version, same as

**Relating clause**:
The words of a Measure's text that say what it does to the statutes: "Relating to human services; amending ORS 409.711." They start on line 2 of page 1 and can run over several lines (SB 69's A-Engrossed Version has three). A Proposed Amendment can edit them.
_Avoid_: title

**Statutes Affected Table**:
Legislative Counsel's official table of the ORS sections each Measure amends, repeals or adds to, published after the Session ("artables", `artables2025R1.pdf`: 64 pages dated 8/19/2025). The worker fetches it from the address `STATUTES_AFFECTED_TABLE_URL` names, reads it again when its bytes change or the OregonAI snapshot changes (a series follows the snapshot's section list; when the table cannot be fetched then, or what the server gives is refused as no table, the copy it holds is read again), and keeps the last copy it read when the server stops giving it (ADR-0034, ADR-0044). It is a second source for Statute Links: `get_measure` sets its entries beside the links parsed from the Version each names (ADR-0033). It is not a Document.
_Avoid_: artables, the cross-reference table

**Table entry**:
One row of the Statutes Affected Table's ORS section, read into the Measure, its engrossing level, an ORS section or chapter, the table's letter ("A", "R" or "Add") and the measure section. A row that omits the ORS number (a continuation row) belongs to the last one above it, and a series ("9.005 to 9.757") is one entry for each section of it that the snapshot lists. The level names a Version: "SB 69 A" is the A-Engrossed Version of SB 69 and no letter is the Introduced Version; a longer level such as "BCC" names none. An "E" alone after the Measure number is the emergency clause of a row at the Introduced Version unless the feed lists an E-Engrossed Version of the Measure; then it is that level or the clause, the table's text does not say which, and the entry names no Version. A row whose Measure was repassed over the Governor's veto ends in "OV" (this Session's) or "OVP" (a previous Session's); an OVP row is kept apart from this Session's entries.
_Avoid_: table link, table row, when an entry is meant

**Confirmed link**:
A Statute Link that amends, repeals or adds to, which the parsed text and a Table entry both have (`confirmed_by_table` in `get_measure`): the same ORS target, the same kind (the table's "A" is amends, "R" repeals, "Add" adds to) and the same measure section. A disagreement is the other two cases, a Table entry with no such parsed link and a parsed link with no such entry, each shown as its source has it. Citations are never compared.

**Agency**:
A state government unit as the OregonAI agency registry names it. A sub-unit (a division with its own OAR chapter) is an Agency of its own, and the registry places it under a parent, which the Snapshot carries (ADR-0029).
_Avoid_: department, issuing body

**Agency Link**:
A connection from a Measure, Version or Proposed Amendment to an Agency, of one kind: named in a Fiscal Impact Statement, named in the text, submitted Testimony, or derived through a Statute Link. Only a Statute Link that amends, repeals or adds to derives one, never a citation (ADR-0027), and a link derived to a sub-unit also gives its parent a link, which says it came through the sub-unit (ADR-0029). A Fiscal Impact Statement's link sits on the Version the statement is of, or on the Measure when the feed places it on none.
_Avoid_: affected agency, unqualified

**Created time**:
When OLIS created the feed's row for a document (its `CreatedDate`), in Pacific time with its offset. It is not the time of a meeting a document is posted to, which is what "posted" means for a Proposed Amendment's posting. A Proposed Amendment posted to several meetings has a posting, and a row, for each: `find_measures` dates a piece of evidence by the documents whose own file holds it, gives an item the earliest and the latest of those times as `created_at` and `last_created_at`, and reads `since` against the latest (ADR-0028). It is also what the clock hides by: the tools show only rows whose created time is at or before the server's clock, and a row with no created time is shown (ADR-0056).
_Avoid_: posted time, posting date, publication date

**Agency registry**:
The OregonAI list of Agencies (slug, name, aliases and more), copied into the build-time snapshot (ADR-0004). The Agency Link extractor takes it as a parameter.
_Avoid_: agency list

**Agency alias**:
Another name the registry lists for an Agency, such as "State Treasurer" for Oregon State Treasury.

**Unresolved unit**:
A government unit that a Fiscal Impact Statement lists under "Government Unit(s) Affected" and that is not an Agency, because the registry does not name it as one: "Cities", "Counties", "TriMet", and the Legislative Assembly even where the registry has a row for it. A state body that the registry given lacks is one too. It is kept as the statement wrote it, never dropped and never forced onto an Agency.
_Avoid_: non-agency unit, other unit

**Snapshot**:
The slice of OregonAI's data copied at build time, from a checkout of its executive-regulatory-frameworks repository: the agency registry, the list of ORS section ids and the Chapter table. It is named by the commit it was read from and the commit's date, which `session_overview` reports. Nothing looks it up again while serving (ADR-0004, ADR-0012).
_Avoid_: cache, mirror

**Chapter table**:
The Snapshot's table from an ORS chapter to the Agencies whose rules implement its sections, found from the rules' links to ORS sections and each rule's OAR chapter. It is how a Statute Link to a chapter reaches an Agency. It lists a sub-unit, not its parent.
_Avoid_: statute-to-agency map

### Evaluation

**Acceptance question**:
One of the questions spec #1 says a release exists to answer, (a) to (f), written as the tool calls an agent would make and what must hold in what it sees. The 2025R1 set (`scripts/eval/questions/2025R1.yml`) keeps (a) as two, one for statutes and one for Fiscal Impact Statements, because they are stories 1 and 2 of the spec, so it has seven. Its expected values are the literals seam 1 already established, and a check names what its question needs, not incidental counts.
_Avoid_: test case, eval case

**Question set**:
The acceptance questions of one Session, as a data file named for it (`2025R1.yml`). A later Session's set is another file and needs no change to the code that runs it.

**Evaluation report**:
What the evaluation runner returns for a database and a question set: the database's As of time, and each question as passed or failed with the moment it was asked at, what "since yesterday" meant to it, and the reason for each failure (the call, the path into its result and what was found there). `npm run eval` prints it and exits 1 when any question failed. Each question names its own moment (its `clock`), and "since yesterday" is the day before that moment in Pacific time, so the answer does not depend on the day the database was pulled; the operator's `--since` overrides it for every question. The runner never asks OLIS, so the Live status of any `get_measure` it makes says the lookup failed.
_Avoid_: test results, score
