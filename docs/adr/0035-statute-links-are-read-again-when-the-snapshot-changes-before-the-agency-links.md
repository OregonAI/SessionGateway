---
status: accepted; supersedes the sentence of ADR-0015's Consequences that a deployment which changes its snapshot rebuilds the database, and closes the open question ADR-0027's Consequences leave on Statute Links
---

# Statute Links are read again from the stored text when the snapshot changes, in the step that reads the Agency Links again and before it

ADR-0015 reads a file's Statute Links once, and a deployment that changes its snapshot rebuilds the database. ADR-0027 then made the worker read every document's Agency Links again when the snapshot's commit changes, so the index never reports a snapshot (`snapshot_state`, `session_overview`) that some of its Agency Links were not made with, and left Statute Links as the exception: their ranges are expanded against the snapshot's ORS section list, so after a change the derived Agency Links are made from links expanded with the old list and the Chapter table of the new one. The owner decided on 2026-10-31 (PR #41 question 5, PR #45 question 1) that a changed commit reads the Statute Links again too: every stored Version and posting of a Proposed Amendment is read again from its stored text, without fetching, with the new section list, in the same step that reads the Agency Links again and before it, because the derived links are made from the Statute Links. The section list does change between commits: the whole snapshot held 37,534 ORS sections at ERF `58e1839` and holds 39,002 at `6c41efefb5` (the fixture's 39 chapters keep their 4,392, so the fixture alone would not show it).

## Considered Options

- **Read them again only when the section list changes**, keyed by a hash of the list, the one part of the snapshot the parser reads. Fewer readings, but a second stamp beside the commit `agency_read` already keeps, for a step that runs only when a deployment's snapshot changes.
- **Keep ADR-0015: rebuild the database.** Until a rebuild, the index reports a snapshot that its Statute Links, and so its derived Agency Links, were not all made with.

## Consequences

- A snapshot change costs one parse of every stored Version and posting, on top of ADR-0027's reading of the Agency Links. The snapshot changes only when a deployment is given a new one.
- A parser fix still rebuilds the database, or deletes a file's reading, as ADR-0015 says: only the snapshot's commit triggers this step.
