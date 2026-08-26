export interface BrowserPreflight {
  preflight(input: BrowserPreflightInput): Promise<BrowserPreflightResult>;
}

export interface BrowserPreflightInput {
  readonly inputSelector: string;
  readonly submitSelector?: string;
  readonly targetUrl: string;
}

export interface BrowserPreflightResult {
  readonly authenticated: boolean;
  readonly issues: readonly string[];
  readonly pageUrl: string;
}
