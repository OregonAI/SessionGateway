import { fileURLToPath } from "node:url";

/**
 * The committed snapshot fixture (test/fixtures/oregonai-snapshot/): the OregonAI snapshot taken from a
 * real checkout of OregonAI's executive-regulatory-frameworks and trimmed to what the 2025R1 fixture
 * touches. A test that gives the worker no snapshot of its own is given this one.
 */
export const snapshotFixturePath: string = fileURLToPath(
  new URL("../fixtures/oregonai-snapshot/snapshot.json", import.meta.url),
);
