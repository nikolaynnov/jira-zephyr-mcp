/**
 * API compatibility probe for the "JIRA 8.12 Server + Zephyr for JIRA 5.6.3 (ZAPI)" fork.
 *
 * READ-ONLY: issues GET requests only, so it is safe to run against production.
 * It reads credentials from `.env` and prints a support matrix for every endpoint
 * the read-only MCP tools depend on, so we can confirm the target server/plugin
 * exposes them before rewriting the JIRA/Zephyr clients.
 *
 * Run:  npm run check-api
 */
import { config as loadEnv } from 'dotenv';
import axios, { AxiosInstance } from 'axios';
import https from 'node:https';

loadEnv();

// ---- configuration -------------------------------------------------------

const BASE_URL = (process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
const USERNAME = process.env.JIRA_USERNAME || '';
// New fork uses login/password Basic auth; accept JIRA_API_TOKEN as a fallback
// so an existing .env keeps working.
const PASSWORD = process.env.JIRA_PASSWORD || process.env.JIRA_API_TOKEN || '';

// Probe fixtures (override via .env). Defaults taken from the reference server.
const ISSUE_KEY = process.env.PROBE_ISSUE_KEY || 'IPLUS-46358';
// Default to a project that has Zephyr test cycles so a bare run exercises ZAPI too.
const PROJECT_KEY = process.env.PROBE_PROJECT_KEY || 'QA';
const PROJECT_ID_OVERRIDE = process.env.PROBE_PROJECT_ID || ''; // e.g. 10660 for QA
const INSECURE_TLS = /^(1|true|yes)$/i.test(process.env.PROBE_INSECURE_TLS || '');
// JIRA is usually an internal host that must be reached directly. axios otherwise
// routes through the corporate forward proxy (HTTP(S)_PROXY env) which cannot reach
// internal hosts and returns 502. Bypass it by default; opt back in with PROBE_USE_PROXY=1.
const envProxy =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY || process.env.http_proxy || '';
const USE_PROXY = /^(1|true|yes)$/i.test(process.env.PROBE_USE_PROXY || '');

if (!BASE_URL || !USERNAME || !PASSWORD) {
  console.error('Missing required env vars. Please set them in .env:');
  console.error('  JIRA_BASE_URL   e.g. https://jira.iss.ru');
  console.error('  JIRA_USERNAME   your login');
  console.error('  JIRA_PASSWORD   your password (JIRA_API_TOKEN is also accepted)');
  process.exit(2);
}

// Some corporate reverse proxies / WAFs in front of JIRA reject non-browser
// clients (e.g. the default `axios/x.y.z` User-Agent) with a 502, so present a
// browser-like User-Agent.
const USER_AGENT =
  process.env.PROBE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  auth: { username: USERNAME, password: PASSWORD },
  headers: {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    'Accept-Language': 'en-US,en;q=0.9',
  },
  timeout: 30000,
  // false => never use a proxy (direct connection, like the browser bypass list).
  proxy: USE_PROXY ? undefined : false,
  ...(INSECURE_TLS ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } : {}),
});

const bodySnippet = (data: unknown): string => {
  if (data == null) return '';
  let s: string;
  if (typeof data === 'string') {
    s = data;
  } else {
    try {
      s = JSON.stringify(data);
    } catch {
      s = String(data);
    }
  }
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? oneLine.slice(0, 200) + '...' : oneLine;
};

// ---- probe harness -------------------------------------------------------

type ProbeStatus = 'OK' | 'FAIL' | 'SKIP';

interface Result {
  tool: string;
  endpoint: string;
  status: ProbeStatus;
  http?: number | string;
  note?: string;
}

const results: Result[] = [];

const record = (r: Result): void => {
  results.push(r);
  const icon = r.status === 'OK' ? '[ OK ]' : r.status === 'SKIP' ? '[SKIP]' : '[FAIL]';
  const code = r.http !== undefined ? ` (${r.http})` : '';
  console.log(`${icon} ${r.tool.padEnd(28)} ${r.endpoint}${code}${r.note ? '  -> ' + r.note : ''}`);
};

const probe = async (
  tool: string,
  endpoint: string,
  fn: () => Promise<{ note?: string; http?: number }>
): Promise<void> => {
  try {
    const { note, http: code } = await fn();
    record({ tool, endpoint, status: 'OK', http: code ?? 200, note });
  } catch (err: any) {
    const code = err?.response?.status ?? err?.code ?? 'ERR';
    const server = err?.response?.headers?.server;
    const apiMsg =
      err?.response?.data?.errorMessages?.[0] || err?.response?.data?.message;
    const body = apiMsg || bodySnippet(err?.response?.data) || err?.message || String(err);
    const note = server ? `${body} [server: ${server}]` : body;
    record({ tool, endpoint, status: 'FAIL', http: code, note });
  }
};

const skip = (tool: string, endpoint: string, note: string): void =>
  record({ tool, endpoint, status: 'SKIP', note });

// ---- checks --------------------------------------------------------------

const main = async (): Promise<void> => {
  console.log('');
  console.log(`API compatibility probe -> ${BASE_URL}`);
  console.log(`user: ${USERNAME}${INSECURE_TLS ? '   (TLS verification disabled)' : ''}`);
  if (envProxy) {
    console.log(
      USE_PROXY
        ? `proxy: using ${envProxy}`
        : `proxy: bypassing ${envProxy} (direct connection; set PROBE_USE_PROXY=1 to use it)`
    );
  }
  console.log('read-only checks, GET only\n');

  // 0. Auth / connectivity (login + password Basic auth)
  await probe('auth', 'GET /rest/api/2/myself', async () => {
    const { data, status } = await http.get('/rest/api/2/myself');
    return { http: status, note: `logged in as ${data?.name || data?.displayName || 'unknown'}` };
  });

  // 1. read_jira_issue
  await probe('read_jira_issue', `GET /rest/api/2/issue/${ISSUE_KEY}`, async () => {
    const { data, status } = await http.get(`/rest/api/2/issue/${ISSUE_KEY}`, {
      params: { fields: 'summary,status,issuetype' },
    });
    return { http: status, note: `${data.key}: ${String(data.fields?.summary ?? '').slice(0, 48)}` };
  });

  // 2. projectKey -> numeric projectId (ZAPI needs the numeric id)
  let projectId = PROJECT_ID_OVERRIDE;
  await probe('project resolve', `GET /rest/api/2/project/${PROJECT_KEY}`, async () => {
    const { data, status } = await http.get(`/rest/api/2/project/${PROJECT_KEY}`);
    if (!PROJECT_ID_OVERRIDE) projectId = String(data.id);
    return { http: status, note: `${PROJECT_KEY} -> id ${data.id}` };
  });

  // 3. project versions (used to build/select test cycles)
  await probe('project versions', `GET /rest/api/2/project/${PROJECT_KEY}/versions`, async () => {
    const { data, status } = await http.get(`/rest/api/2/project/${PROJECT_KEY}/versions`);
    return { http: status, note: `${Array.isArray(data) ? data.length : 0} version(s)` };
  });

  // 3b. detect the "Test" issue type name (localized on some instances, e.g. Russian)
  let testIssueType = process.env.PROBE_TEST_ISSUETYPE || '';
  await probe('issue types', 'GET /rest/api/2/issuetype', async () => {
    const { data, status } = await http.get('/rest/api/2/issuetype');
    const types: any[] = Array.isArray(data) ? data : [];
    if (!testIssueType) {
      const exact = types.find((t) => /^(test|тест)$/i.test(String(t.name)));
      const fuzzy = types.find((t) => /(test|тест)/i.test(String(t.name)));
      testIssueType = (exact || fuzzy)?.name || '';
    }
    return { http: status, note: `${types.length} types; test type: ${testIssueType || 'not found'}` };
  });

  // 4. search_test_cases (in Zephyr Squad a test case is a JIRA issue of the "Test" type)
  let sampleTestIssueId = '';
  const testJql = testIssueType
    ? `project = ${PROJECT_KEY} AND issuetype = "${testIssueType}"`
    : `project = ${PROJECT_KEY}`;
  await probe('search_test_cases', `GET /rest/api/2/search (${testIssueType || 'any issuetype'})`, async () => {
    const { data, status } = await http.get('/rest/api/2/search', {
      params: { jql: testJql, maxResults: 1, fields: 'summary' },
    });
    sampleTestIssueId = data.issues?.[0]?.id || '';
    return { http: status, note: `${data.total ?? 0} issue(s) for jql` };
  });

  // ---- ZAPI (Zephyr for JIRA / Squad Server) ----
  if (!projectId) {
    skip(
      'list_test_cycles',
      'GET /rest/zapi/latest/util/versionBoard-list',
      'no projectId (project resolve failed and PROBE_PROJECT_ID not set)'
    );
    skip('get_test_execution_status', 'GET /rest/zapi/latest/execution', 'no projectId');
  } else {
    // 5. version board = cycles grouped by version (source for list_test_cycles)
    await probe(
      'list_test_cycles (board)',
      `GET /rest/zapi/latest/util/versionBoard-list?projectId=${projectId}`,
      async () => {
        const { data, status } = await http.get('/rest/zapi/latest/util/versionBoard-list', {
          params: { projectId },
        });
        const count = Array.isArray(data) ? data.length : (data?.cyclesList?.length ?? 0);
        return { http: status, note: `board rows: ${count}` };
      }
    );

    // 6. cycles for a version (-1 = unscheduled, always present)
    let sampleCycleId = '';
    let sampleVersionId = '-1';
    await probe(
      'list_test_cycles (cycles)',
      `GET /rest/zapi/latest/cycle?projectId=${projectId}&versionId=-1`,
      async () => {
        const { data, status } = await http.get('/rest/zapi/latest/cycle', {
          params: { projectId, versionId: -1 },
        });
        // Response is a map { "<cycleId>": {...}, recordsCount, ... }
        const ids = Object.keys(data || {}).filter((k) => /^\d+$/.test(k));
        if (ids.length) sampleCycleId = ids[0];
        return { http: status, note: `${ids.length} cycle(s) in unscheduled` };
      }
    );

    // 6b. if unscheduled has no cycles, look through real project versions
    if (!sampleCycleId) {
      try {
        const { data: versions } = await http.get(`/rest/api/2/project/${PROJECT_KEY}/versions`);
        const vlist: any[] = Array.isArray(versions) ? versions : [];
        for (const v of vlist.slice(0, 20)) {
          const { data } = await http.get('/rest/zapi/latest/cycle', {
            params: { projectId, versionId: v.id },
          });
          const ids = Object.keys(data || {}).filter((k) => /^\d+$/.test(k));
          if (ids.length) {
            sampleCycleId = ids[0];
            sampleVersionId = String(v.id);
            break;
          }
        }
      } catch {
        /* discovery is best-effort */
      }
    }

    // 7. executions for a cycle (source for get_test_execution_status / generate_test_report)
    if (sampleCycleId) {
      await probe(
        'get_test_execution_status',
        `GET /rest/zapi/latest/execution?cycleId=${sampleCycleId}`,
        async () => {
          const { data, status } = await http.get('/rest/zapi/latest/execution', {
            params: { cycleId: sampleCycleId, projectId, versionId: sampleVersionId },
          });
          const n = data?.executions?.length ?? 0;
          return { http: status, note: `${n} execution(s) (cycle ${sampleCycleId}, version ${sampleVersionId})` };
        }
      );
    } else {
      skip(
        'get_test_execution_status',
        'GET /rest/zapi/latest/execution?cycleId=...',
        'no cycle found in unscheduled version to probe'
      );
    }
  }

  // 8. get_test_case -> ZAPI test steps of a "Test" issue
  if (sampleTestIssueId) {
    await probe('get_test_case (steps)', `GET /rest/zapi/latest/teststep/${sampleTestIssueId}`, async () => {
      const { data, status } = await http.get(`/rest/zapi/latest/teststep/${sampleTestIssueId}`);
      const n = data?.stepBeanCollection?.length ?? (Array.isArray(data) ? data.length : 0);
      return { http: status, note: `${n} step(s)` };
    });
  } else {
    skip(
      'get_test_case (steps)',
      'GET /rest/zapi/latest/teststep/{issueId}',
      'no Test issue found to probe'
    );
  }

  // ---- summary ----
  const ok = results.filter((r) => r.status === 'OK').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log('\n----------------------------------------');
  console.log(`Summary: ${ok} OK, ${fail} FAIL, ${skipped} SKIP  (of ${results.length})`);
  console.log('Excluded on purpose: create_test_plan / list_test_plans - Zephyr Squad has no Test Plan concept.');

  process.exit(fail > 0 ? 1 : 0);
};

main().catch((e) => {
  console.error('Probe crashed:', e?.message || e);
  process.exit(2);
});
