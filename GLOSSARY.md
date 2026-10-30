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

**As of**:
When the Index was last refreshed from OLIS: the moment the latest completed full pull began, shown in Pacific time with its UTC offset. Every result carries it.

### Measures and their texts

**Measure**:
A bill, joint resolution, concurrent resolution, memorial or resolution in one Session, identified by Session, prefix and number (HB 3318 in 2025R1).
_Avoid_: bill, when resolutions and memorials are included

**Catchline**:
A Measure's one-sentence statement of what it does, as the feed's `CatchLine` gives it.
_Avoid_: title, summary

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

**Printed Amendment**:
The printed text of amendments a chamber adopted, such as "House Amendments to Introduced".
_Avoid_: amendment, unqualified

**Testimony**:
A document a person or organization submitted to a committee on a Measure or topic.
_Avoid_: comment, letter

**Exhibit**:
A document posted to a committee meeting's record, other than Testimony: meeting materials, presentations, witness-registration lists.
_Avoid_: meeting document, attachment

**Recording Log**:
A committee's timecoded index of one meeting's recording: agenda items, motions, votes and each speaker.
_Avoid_: minutes

**Fiscal Impact Statement**:
The Legislative Fiscal Office's statement of what a Version would cost government, naming the Agencies affected under "Government Unit(s) Affected".
_Avoid_: fiscal note

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
