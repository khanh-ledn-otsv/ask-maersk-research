export interface BrowserPreflight {
  preflight(input: BrowserPreflightInput): Promise<BrowserPreflightResult>;
}

export interface BrowserPreflightInput {
  readonly inputSelector?: string;
  readonly submitSelector?: string;
  readonly targetUrl: string;
}

export interface BrowserPreflightControls {
  readonly assistant: string;
  readonly drawerTrigger?: string;
  readonly input: string;
  readonly loading: string;
  readonly submit?: string;
}

export interface BrowserPreflightResult {
  readonly authenticated: boolean;
  readonly controls?: BrowserPreflightControls;
  readonly issues: readonly string[];
  readonly pageUrl: string;
}
