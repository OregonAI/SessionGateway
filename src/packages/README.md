# Packages are deep modules

Each folder under `src/packages/` is one package: a lot of behaviour behind a small interface. Its **root files are its entry points**; everything in its subfolders is hidden. `/codebase-design` has the vocabulary.

```
src/packages/
  <name>/
    index.ts        ← an entry point. Import this from outside.
    client.ts       ← another entry point. A package may expose several.
    lib/            ← implementation: hidden from outside, free to import each other.
    tests/          ← the package's own tests (seam-2 parser tables live here).
```

`example/` is a copy-me template: copy it to start a package, or delete it once a real package exists.

**Import only through a package's entry points (its root files)**, from app code, from another package and from every test. Prefer several small entry points to one barrel `index.ts` that re-exports a whole subtree: a barrel turns the package's interface into everything it contains.

The rules, all errors, checked by `npm run lint:boundaries` (`depcruise src test`, config in `.dependency-cruiser.cjs`):

1. **Entry-point boundary.** Code outside a package, including seam-1 tests and the harness under `test/`, imports only that package's root files, never a file in its subfolders.
2. **Intra-package freedom.** A package's own files import each other freely.
3. **Tests through the entry points.** A package's `tests/` import any package's entry points and their own `tests/` fixtures, never any package's internals, not even their own. Nothing outside a `tests/` folder imports from one.
4. **No cycles.**

Both `#/packages/<name>/lib/…` and relative deep imports are caught. A boundary check that cruised 0 modules checked nothing, which is why `npm run check` fails on it (root `CLAUDE.md`).
