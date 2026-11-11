# Made-up files

EVERY FILE HERE IS MADE UP. None is a public record, none came from OLIS, and none is in the 2025R1 fixture's manifest, whose entries are the bytes OLIS served (`../CLAUDE.md`). A file goes here only when a test needs bytes of a kind that cannot be written by a helper in `test/support/` (`made-up-pdf.ts` writes plain PDFs from lines of text) and no committed real document has them.

## password-protected.pdf (ticket #178)

One blank US Letter page, encrypted with AES-128 (`/V 4`, `/R 4`, crypt filter `/AESV2`) and a user password, so PDF.js cannot open it without one (`PasswordException`, "No password given"). The passwords are `made-up-user` and `made-up-owner`; its `/Title` says it is made up. It stands in for a Testimony upload that needs a password to open, which nothing in the fixture is.

It was written on 2026-11-10 with pypdf 6.14.2 (Python 3.12):

```python
from pypdf import PdfWriter
w = PdfWriter()
w.add_blank_page(width=612, height=792)
w.add_metadata({"/Title": "MADE UP: a blank page that needs a user password (SessionGateway ticket #178)"})
w.encrypt(user_password="made-up-user", owner_password="made-up-owner", algorithm="AES-128")
with open("password-protected.pdf", "wb") as f:
    w.write(f)
```

Encryption draws a random key and file id, so running it again writes other bytes of the same kind. The committed file's sha256 is `7a709222def642ea331a9515755d6f4648ec3222a86996b886783d00b4fda30e` (1,176 bytes); the seam-4 test that reads it (`src/packages/pdf-text/tests/unreadable.test.ts`) checks that hash first, so a replaced file fails by name.
