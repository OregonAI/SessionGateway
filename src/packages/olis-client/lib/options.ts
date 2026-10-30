export type OlisClientOptions = {
  /** The service root, ending in a slash: https://api.oregonlegislature.gov/odata/odataservice.svc/ */
  baseUrl: string;
  fetch: typeof fetch;
  documents: {
    /** The origin the documents are fetched from: OLIS's own, https://olis.oregonlegislature.gov, except in a test. */
    origin: string;
    /** How long one attempt to fetch a document may take. */
    timeoutMs: number;
    /** Waits between attempts. Passed in, so a test does not wait. */
    pause: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  };
};
