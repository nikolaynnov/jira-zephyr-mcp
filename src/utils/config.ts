import { config } from 'dotenv';
import https from 'node:https';
import { z } from 'zod';

config();

const isTruthy = (value: string | undefined): boolean =>
  /^(1|true|yes)$/i.test((value || '').trim());

// Fork target: JIRA 8.12 Server + Zephyr for JIRA 5.6.3 (ZAPI). Two auth modes
// are supported so the same server works across JIRA versions:
//   - Bearer (Personal Access Token) via JIRA_API_TOKEN — JIRA 8.14+ only.
//   - Basic (login/password) via JIRA_USERNAME + JIRA_PASSWORD — works on any
//     version, including JIRA < 8.14 which predates PATs.
// When JIRA_API_TOKEN is set it takes precedence, so upgrading to 8.14+ is just
// a matter of dropping the token in and removing the username/password.
// ZAPI rides on the same JIRA session, so no separate Zephyr token is required.
const configSchema = z
  .object({
    JIRA_BASE_URL: z.string().url(),
    JIRA_USERNAME: z.string().min(1).optional(),
    JIRA_PASSWORD: z.string().min(1).optional(),
    // Personal Access Token (Bearer). Preferred on JIRA 8.14+.
    JIRA_API_TOKEN: z.string().min(1).optional(),
    // Name of the "Test" issue type in Zephyr Squad. Often localized (e.g. "Тест").
    // Optional: the client auto-detects it when omitted.
    JIRA_TEST_ISSUE_TYPE: z.string().optional(),
  })
  .refine(
    data => Boolean(data.JIRA_API_TOKEN) || Boolean(data.JIRA_USERNAME && data.JIRA_PASSWORD),
    {
      message:
        'Provide JIRA_API_TOKEN (Bearer/PAT, JIRA 8.14+) or JIRA_USERNAME + JIRA_PASSWORD (Basic auth).',
    }
  );

type AppConfig = z.infer<typeof configSchema>;

let cachedConfig: AppConfig | null = null;

const validateConfig = (): AppConfig => {
  try {
    const result = configSchema.safeParse(process.env);

    if (!result.success) {
      const errors = result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      const errorMessage = `Configuration validation failed:\n${errors.join('\n')}`;
      console.error(errorMessage);
      console.error('Please ensure the following environment variables are set:');
      console.error('- JIRA_BASE_URL (valid URL, e.g. https://jira.example.com)');
      console.error('- Authentication, either:');
      console.error('    * JIRA_API_TOKEN (Personal Access Token, JIRA 8.14+), or');
      console.error('    * JIRA_USERNAME + JIRA_PASSWORD (Basic auth, any JIRA version)');
      console.error('- JIRA_TEST_ISSUE_TYPE (optional, e.g. "Test" or "Тест")');
      throw new Error(errorMessage);
    }

    return result.data;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Failed to validate configuration:', errorMessage);
    throw error;
  }
};

export const getAppConfig = (): AppConfig => {
  if (!cachedConfig) {
    cachedConfig = validateConfig();
  }
  return cachedConfig;
};

// Returns the auth mode plus the pieces each mode needs. Bearer (PAT) wins when
// a token is present; otherwise Basic login/password is used.
export const getJiraAuth = () => {
  const config = getAppConfig();
  if (config.JIRA_API_TOKEN) {
    return { type: 'bearer' as const, token: config.JIRA_API_TOKEN };
  }
  return {
    type: 'basic' as const,
    username: config.JIRA_USERNAME as string,
    password: config.JIRA_PASSWORD as string,
  };
};

export const getJiraBaseUrl = (): string =>
  getAppConfig().JIRA_BASE_URL.replace(/\/+$/, '');

export const getConfiguredTestIssueType = (): string | undefined =>
  getAppConfig().JIRA_TEST_ISSUE_TYPE?.trim() || undefined;

// Shared axios options for every request to the JIRA host (REST + ZAPI).
// JIRA is usually an internal host: bypass the corporate forward proxy by
// default (it returns 502 for internal hosts) and present a browser-like
// User-Agent since some reverse proxies reject the default axios UA.
export const getHttpClientOptions = () => {
  const useProxy = isTruthy(process.env.JIRA_USE_PROXY);
  const insecureTls = isTruthy(process.env.JIRA_INSECURE_TLS);
  const userAgent =
    process.env.JIRA_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  const auth = getJiraAuth();

  return {
    // Basic auth uses axios' `auth` option; Bearer (PAT) goes in the header.
    ...(auth.type === 'basic'
      ? { auth: { username: auth.username, password: auth.password } }
      : {}),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': userAgent,
      ...(auth.type === 'bearer' ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    timeout: 30000,
    // false => never use a proxy (direct connection).
    proxy: useProxy ? undefined : (false as const),
    ...(insecureTls ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } : {}),
  };
};