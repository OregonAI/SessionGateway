---
status: accepted (owner decision of 2026-11-10, ticket #174); amends ADR-0055 ("The transcript pages with the log": an agent can ask for the part that holds a turn); no schema step (ADR-0048)
---

# get_document takes a turn's timecode and answers with the part that holds it

With the transcripts published, a Recording Log's `get_document` runs to several parts, because a turn's transcript passages are paged with the turns (ADR-0055). Every part lists every turn, but a turn whose words are in another part simply has no `transcript` key, and nothing says which part holds them. An agent looking for what a speaker said at a moment had to page blindly or rely on `search`, and #136's hearing questions had to pin a `part` for each turn (2026R1's logs run to 4 to 6 parts with the gate on).

## Decision

The owner chose option (b) of ticket #174 on 2026-11-10:

- **`get_document` takes an optional `timecode`**, a turn's timecode as the log writes it and as `speaker_turns.turns[].timecode` gives it ("00:20:41"; "h:mm:ss" or "hh:mm:ss"). For a Recording Log it answers with the part that holds that turn: the answer is the same object a call with that `part` would give, so nothing new is added to the output.
- **Which part.** A timecode names a turn when the turn's logged timecode is the same second. When two turns of a log have the same timecode, the first in the index's order is the one. With the gate on and a transcript, the part is the first part that lists the turn with its `transcript`: the part its line is in, which carries its first passage, since the first passage is never parted from the turn's line (ADR-0055). A turn whose words carry on is then read on in the parts after it, by number. With the gate off, or on a log with no transcript, the log is cut as its text alone and the part is the one holding where the worker placed the turn's line (the start of the turn's Passage, ADR-0053; a turn it could not place takes the place of the turn before it, as the paging does). The reader gives those places with `turnTextOffsetsOf`, which reads the speaker-turn index and the log's own Passages and nothing of a transcript, so the gate's rule that nothing of a transcript is read while it is off (ADR-0055) holds.
- **A timecode on a document that is not a Recording Log is refused**, naming what the document is: only a log has speaker turns.
- **A timecode no turn has is refused**, naming the turn that begins last before it and the one that begins first after it, each with its timecode and speaker as logged, or saying it is before the first turn or after the last. The nearest turn is not taken for it: a timecode between two turns is inside the earlier one, and an agent that guessed a timecode should know it guessed. A log with no speaker-turn index (a gap, or not read yet) has no turn at all, and the refusal says so.
- **`part` and `timecode` together are refused.** They can name different parts, and taking one over the other would answer a question the agent did not ask. The refusal says to ask with the timecode alone and then for the parts after it by number.
- **Without a timecode nothing changes**: the answer is word for word what it was, with the gate on or off.

## Considered Options

- **(a) Each turn in every part carries the `part` that holds its transcript.** Not chosen. Against it: it adds a field to every turn of every part, so an answer is larger with the gate on in every part, and an agent still makes two calls (part 1, then the part named). It also needs a decision on what the field says with the gate off.
- **A timecode between two turns answers with the turn in progress.** Not chosen: the answer is an error that names the nearest turns; a timecode read off a recording player is seldom a turn's start, and the earlier turn is named in the error, so the agent's next call is one step.
- **The timecode wins over `part`, or `part` wins.** Rejected: see above.
- **A `turn` position instead of a timecode.** Rejected: an agent has the timecode from the log's text, `search` and `get_measure`; a position is the index's, and the log does not print it.

## Consequences

- #136's five hearing questions (`scripts/eval/questions/2026R1.yml`, `h-*`) ask `get_document` with the turn's timecode instead of a pinned part. Each still checks that the part's text holds the stored log's line of that turn, so the answer rests on the stored text and not on a tool's output.
- No fixture log, and no 2026R1 log (the longest is 11,270 characters), is more than one part with the gate off, so the gate-off branch that picks among two or more parts is not reached by a seam-1 test; the seam-1 cases are in `test/tools/get-document-timecode.test.ts`, over the made-up transcript of `transcripts-paged.test.ts`.
