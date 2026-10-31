---
status: accepted; the 15-minute increments and the nightly full pull are superseded in part by ADR-0039 (the two rhythms are configuration); the live lookups, the two-pull rule and the replaced files stand
---

# Read OLIS within its terms: live lookups, 15-minute increments, a nightly full pull

The OData feed has no change tracking and no ETags, and `ModifiedDate` is null on whole entity sets (every MeasureDocument and MeasureAnalysisDocument row). Its Acceptable Use Agreement allows a full refresh only "once per day after business hours between 5:00 pm-6:00 am Pacific Time", but allows "incremental refreshes as often as needed" and "on-demand queries as needed". So:

- **Live lookups.** Status, history, schedule and votes for one Measure are read from OData when the request arrives, with an "as of" time. If OData fails, the cached copy answers and says so.
- **Increments.** During a Live Session an incremental refresh runs every 15 minutes, 6 am–10 pm Pacific on days the Session meets. It queries `CreatedDate gt X or ModifiedDate gt X` with a two-hour overlap; FloorLetters, which carry no dates, by `FloorLetterId`. A document is fetched when its row appears, once, as part of the increment rather than waiting for the night window. New documents are searchable within about an hour.
- **Nightly full pull,** inside the window. Only a complete pull (every set's rows match `$count`) can show deletions. A row absent from two complete pulls in a row is marked no longer listed: it leaves search results and stays fetchable by id. One missing pull is not a withdrawal.
- **Replaced files.** A fetched document is treated as unchanging, except agendas, which are fetched again when `AgendaRevisionNumber` changes. Each night about 200 random documents are fetched again and their hashes compared, to catch a file replaced behind the same URL.

The agreement says clients "must electronically accept" it, but the service has no acceptance step and no credentials. We follow its refresh terms and do not contact the Legislature about acceptance or bulk access.
