export type OlisClientOptions = {
  /** The service root, ending in a slash: https://api.oregonlegislature.gov/odata/odataservice.svc/ */
  baseUrl: string;
  fetch: typeof fetch;
};
