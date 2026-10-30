export type OlisClientOptions = {
  /** The service root, such as https://api.oregonlegislature.gov/odata/odataservice.svc/ */
  baseUrl: string;
  fetch: typeof fetch;
};
