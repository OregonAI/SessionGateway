---
status: accepted; "2025R1 is the Session we build and test on" is amended by ADR-0046 (2026R1 is the Session we build on; 2025R1 stays the fixture's Session); the rest stands
---

# One Session per deployment, 2025R1 onward

A deployment serves exactly one Session. When a new Session starts, the current deployment is dropped and a new one is deployed for the new Session; closed Sessions are not kept online. Sessions before 2025R1 are out of scope, and interim and special sessions are deferred.

2025R1 is the Session we build and test on (closed, complete, already cached). 2027R1 is the first Live Session, served from its first day. Nothing needs a closed Session online: questions that span sessions go to the OregonAI legislature corpus, which holds 2017R1 through 2026R1.
