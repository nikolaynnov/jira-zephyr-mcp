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
// A label expected to exist on some Test issues, used to validate JQL label filtering.
const PROBE_LABEL = process.env.PROBE_LABEL || 'modules';
// Concrete example of an already-linked defect<->test pair used to reverse-engineer
// how "link_tests_to_issues" (execution -> issue) is stored. IPLUS-42214 is a defect
// linked to Test QA-1157 with "Affects test execution of"; override via .env.
const PROBE_DEFECT_KEY = process.env.PROBE_DEFECT_KEY || 'IPLUS-42214';
const PROBE_LINKED_TEST_KEY = process.env.PROBE_LINKED_TEST_KEY || 'QA-1157';
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
  let sampleTestIssueKey = '';
  // An issue id known to have executions (filled in by the cycle executions probe),
  // preferred for the issueId probe so it exercises a non-empty response.
  let executedIssueId = '';
  const testJql = testIssueType
    ? `project = ${PROJECT_KEY} AND issuetype = "${testIssueType}"`
    : `project = ${PROJECT_KEY}`;
  await probe('search_test_cases', `GET /rest/api/2/search (${testIssueType || 'any issuetype'})`, async () => {
    const { data, status } = await http.get('/rest/api/2/search', {
      params: { jql: testJql, maxResults: 1, fields: 'summary' },
    });
    sampleTestIssueId = data.issues?.[0]?.id || '';
    sampleTestIssueKey = data.issues?.[0]?.key || '';
    return { http: status, note: `${data.total ?? 0} issue(s) for jql` };
  });

  // 4b. search by label via native JQL — proves exact label filtering is one clause away.
  //     This is the cheap alternative to fuzzy `summary ~ ...` full-text search.
  const labelJql = testIssueType
    ? `project = ${PROJECT_KEY} AND issuetype = "${testIssueType}" AND labels = "${PROBE_LABEL}"`
    : `project = ${PROJECT_KEY} AND labels = "${PROBE_LABEL}"`;
  await probe('search by label (JQL labels=)', `GET /rest/api/2/search (labels = ${PROBE_LABEL})`, async () => {
    const { data, status } = await http.get('/rest/api/2/search', {
      params: { jql: labelJql, maxResults: 3, fields: 'summary,labels,components' },
    });
    const first = data.issues?.[0];
    const lbls = first ? (first.fields?.labels ?? []).join('|') : 'none';
    return { http: status, note: `${data.total ?? 0} issue(s) with label ${PROBE_LABEL}; sample labels: ${lbls}` };
  });

  // 4c. Reproduce what search_test_cases builds TODAY when a user passes
  //     query="labels = modules": the tool wraps it as full-text, so it searches
  //     for the literal phrase in summary/text -> 0 hits. Demonstrates the root
  //     cause of the tester's "labels = modules returned 0" complaint.
  const wrappedJql = testIssueType
    ? `project = ${PROJECT_KEY} AND issuetype = "${testIssueType}" AND (summary ~ "labels = ${PROBE_LABEL}" OR text ~ "labels = ${PROBE_LABEL}")`
    : `project = ${PROJECT_KEY} AND (summary ~ "labels = ${PROBE_LABEL}" OR text ~ "labels = ${PROBE_LABEL}")`;
  await probe('search_test_cases wrap (current)', `GET /rest/api/2/search (query wrapped as full-text)`, async () => {
    const { data, status } = await http.get('/rest/api/2/search', {
      params: { jql: wrappedJql, maxResults: 3, fields: 'summary' },
    });
    return { http: status, note: `${data.total ?? 0} issue(s) — this is why "labels = ${PROBE_LABEL}" returns 0` };
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
          const execs = data?.executions ?? [];
          const n = execs.length;
          // Capture a real executed issue id so the issueId probe below has a
          // non-empty case, and surface the field names for client mapping.
          const first = execs[0];
          if (first?.issueId) executedIssueId = String(first.issueId);
          const fields = first ? Object.keys(first).join(',') : 'none';
          return {
            http: status,
            note: `${n} exec (cycle ${sampleCycleId}); fields: ${fields}`,
          };
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

  // 9. get_test_case_executions -> ZAPI execution history of a single "Test" issue.
  // Powers the new get_test_case_executions tool and get_test_case includeExecutions.
  // Prefer an issue id that actually has executions (from the cycle probe above);
  // fall back to the first Test issue found.
  const executionsIssueId = executedIssueId || sampleTestIssueId;
  if (executionsIssueId) {
    await probe(
      'get_test_case_executions',
      `GET /rest/zapi/latest/execution?issueId=${executionsIssueId}`,
      async () => {
        const { data, status } = await http.get('/rest/zapi/latest/execution', {
          params: { issueId: executionsIssueId },
        });
        const execs = data?.executions ?? [];
        const first = execs[0];
        const fields = first ? Object.keys(first).join(',') : 'none';
        return { http: status, note: `${execs.length} execution(s); fields: ${fields}` };
      }
    );
  } else {
    skip(
      'get_test_case_executions',
      'GET /rest/zapi/latest/execution?issueId=...',
      'no Test issue found to probe'
    );
  }

  // 9b. link_tests_to_issues (WRITE tool design probe) — READ-ONLY inspection.
  //     "Link a test to issues" has two plausible meanings on this platform:
  //       (A) a native JIRA issue link (Test issue <-> other issue) created via
  //           POST /rest/api/2/issueLink, which needs a link TYPE name. We can
  //           read the available types and any existing links without writing.
  //       (B) attach a DEFECT to a Zephyr execution (the failed-run -> bug case),
  //           which is a ZAPI write; here we only confirm the read shape exists.
  //     These probes gather the facts needed to design the tool (esp. the link
  //     type the current schema is missing) without performing any write.
  await probe('link types (issueLinkType)', 'GET /rest/api/2/issueLinkType', async () => {
    const { data, status } = await http.get('/rest/api/2/issueLinkType');
    const types: any[] = data?.issueLinkTypes ?? [];
    const names = types.map((t) => t?.name).filter(Boolean);
    console.log('\n--- available JIRA issue link types ---');
    for (const t of types.slice(0, 12)) {
      console.log(`  ${t?.name}: inward="${t?.inward}", outward="${t?.outward}"`);
    }
    console.log('--- end link types ---\n');
    return { http: status, note: `${names.length} type(s): ${names.slice(0, 6).join(', ')}` };
  });

  // 9c. existing issue links on a real Test issue — shows the payload shape a
  //     link-reading/creating tool would produce, and whether Test issues
  //     already carry links (Tests, blocks, relates, defect, etc.).
  if (sampleTestIssueKey) {
    await probe('issue links (read Test issue)', `GET /rest/api/2/issue/${sampleTestIssueKey}?fields=issuelinks`, async () => {
      const { data, status } = await http.get(`/rest/api/2/issue/${sampleTestIssueKey}`, {
        params: { fields: 'issuelinks' },
      });
      const links: any[] = data?.fields?.issuelinks ?? [];
      const sample = links.slice(0, 3).map((l) => {
        const other = l?.outwardIssue || l?.inwardIssue;
        const dir = l?.outwardIssue ? l?.type?.outward : l?.type?.inward;
        return `${l?.type?.name}/${dir} -> ${other?.key}`;
      });
      return { http: status, note: `${links.length} link(s) on ${sampleTestIssueKey}${sample.length ? '; ' + sample.join('; ') : ''}` };
    });
  } else {
    skip('issue links (read Test issue)', 'GET /rest/api/2/issue/{key}?fields=issuelinks', 'no Test issue found to probe');
  }

  // 9d. link_tests_to_issues PIVOT (execution -> issue defect link).
  //     User picked the SECOND meaning: attach a defect to a test's EXECUTION,
  //     rendered in JIRA as "Affects test execution of" on the defect. That
  //     relation is NOT in the 13 issueLinkType results, so it is ZAPI-managed,
  //     not POST /rest/api/2/issueLink. Reverse-engineer it from a known pair
  //     (defect PROBE_DEFECT_KEY <-> test PROBE_LINKED_TEST_KEY) — READ-ONLY.

  // 9d-1. Does the defect expose the relation as a native JIRA issue link?
  //       If issuelinks is empty here, the link truly lives only in ZAPI.
  await probe('defect issue links (native?)', `GET /rest/api/2/issue/${PROBE_DEFECT_KEY}?fields=issuelinks`, async () => {
    const { data, status } = await http.get(`/rest/api/2/issue/${PROBE_DEFECT_KEY}`, {
      params: { fields: 'issuelinks' },
    });
    const links: any[] = data?.fields?.issuelinks ?? [];
    const sample = links.slice(0, 5).map((l) => {
      const other = l?.outwardIssue || l?.inwardIssue;
      const dir = l?.outwardIssue ? l?.type?.outward : l?.type?.inward;
      return `${l?.type?.name}/${dir} -> ${other?.key}`;
    });
    return { http: status, note: `${links.length} native link(s) on ${PROBE_DEFECT_KEY}${sample.length ? '; ' + sample.join('; ') : ''}` };
  });

  // 9d-2. ZAPI: list the executions of the linked test, then look for the
  //       defect among each execution's defect fields. Confirms the link is
  //       stored at execution level and reveals the executionId a write tool
  //       would target plus the exact field carrying the defect key.
  await probe('execution defects (linked test)', `GET /rest/zapi/latest/execution?issueId=<${PROBE_LINKED_TEST_KEY}>`, async () => {
    const issueRes = await http.get(`/rest/api/2/issue/${PROBE_LINKED_TEST_KEY}`, { params: { fields: 'summary' } });
    const linkedTestId = issueRes.data?.id;
    if (!linkedTestId) return { http: issueRes.status, note: `could not resolve id for ${PROBE_LINKED_TEST_KEY}` };
    const { data, status } = await http.get('/rest/zapi/latest/execution', { params: { issueId: linkedTestId } });
    const execs: any[] = data?.executions ?? [];
    const first = execs[0];
    const fields = first ? Object.keys(first).filter(k => /defect/i.test(k)).join(',') || 'none' : 'none';
    const hit = execs.find((e: any) =>
      JSON.stringify(e).includes(PROBE_DEFECT_KEY));
    console.log('\n--- linked-test execution defect fields ---');
    if (hit) {
      console.log(JSON.stringify({
        executionId: hit.id,
        cycleName: hit.cycleName,
        status: hit.status?.name ?? hit.executionStatus,
        executionDefects: hit.executionDefects,
        defectList: hit.defectList,
        defects: hit.defects,
      }, null, 2));
    } else {
      console.log(`defect ${PROBE_DEFECT_KEY} not found inline; defect-ish fields on first exec: ${fields}`);
    }
    console.log('--- end linked-test execution defects ---\n');
    return { http: status, note: `${execs.length} execution(s) of ${PROBE_LINKED_TEST_KEY}; ${hit ? `defect on execId=${hit.id}` : 'defect not inline'}` };
  });

  // 9d-3. Discover the ZAPI defect/link-write surface without calling it.
  //       NOTE: GET-probing turned out UNRELIABLE here — ZAPI returns 404 (not
  //       405) for unknown method+path, so a GET on a POST-only route can't be
  //       distinguished from a missing route. Kept as documentation of what was
  //       tried. Follow-up leads to verify (from ZAPI 5.x, user-provided):
  //         (a) POST /rest/zapi/latest/test/addIssueLink?parentIssueId=&testcaseId=
  //             — likely what the ORIGINAL pre-fork code meant (test-case ->
  //             issue coverage link; matches old Scale POST /testcases/{id}/links).
  //         (b) POST/GET /rest/zapi/latest/teststep/issueId/{id} — step-level
  //             defects; needs testStep tooling we don't have yet.
  //       User will confirm tomorrow how links are set manually in the UI before
  //       we pick the endpoint. NO write is performed here.
  await probe('ZAPI defect/link-write surface (unreliable: 404!=405)', 'GET candidate endpoints', async () => {
    // Resolve a real executionId that already carries the sample defect.
    const issueRes = await http.get(`/rest/api/2/issue/${PROBE_LINKED_TEST_KEY}`, { params: { fields: 'summary' } });
    const linkedTestId = issueRes.data?.id;
    let execId = '';
    if (linkedTestId) {
      const execRes = await http.get('/rest/zapi/latest/execution', { params: { issueId: linkedTestId } });
      const execs: any[] = execRes.data?.executions ?? [];
      const hit = execs.find((e: any) => JSON.stringify(e).includes(PROBE_DEFECT_KEY)) || execs[0];
      execId = hit ? String(hit.id) : '';
    }
    const candidates = [
      `/rest/zapi/latest/execution/${execId || '0'}/defect`,
      `/rest/zapi/latest/execution/${execId || '0'}`,
      // user-provided leads (POST routes; GET here only to see if path resolves):
      '/rest/zapi/latest/test/addIssueLink',
      linkedTestId ? `/rest/zapi/latest/teststep/issueId/${linkedTestId}` : '/rest/zapi/latest/teststep/issueId/0',
    ];
    console.log('\n--- ZAPI defect/link-write candidate endpoints (GET only; 404 is inconclusive) ---');
    for (const path of candidates) {
      const r = await http.get(path, { validateStatus: () => true });
      console.log(`  ${r.status}  GET ${path}`);
    }
    console.log('--- end candidate endpoints ---\n');
    return { http: 200, note: `probed ${candidates.length} candidates for execId=${execId || 'n/a'} (GET status is not conclusive for POST routes)` };
  });

  // 10. ZQL execution search — the potential one-call answer to
  //     "executions with label=X and status=FAIL in cycle/version Y".
  //     ZQL is Zephyr's own query language (distinct from Jira's JQL) and runs
  //     against executions, not issues. If this endpoint exists we can push
  //     label/status/fixVersion filtering to the server instead of paging
  //     whole cycles and filtering client-side.
  if (projectId) {
    const runZql = async (zqlQuery: string) => {
      const { data, status } = await http.get('/rest/zapi/latest/zql/executeSearch', {
        params: { zqlQuery, maxRecords: 50 },
      });
      const execs = data?.executions ?? [];
      const total = data?.totalCount ?? data?.executionsCount ?? execs.length;
      const fields = execs[0] ? Object.keys(execs[0]).join(',') : 'none';
      return { total, fields, execs, http: status };
    };
    const tryZql = async (label: string, clause: string) => {
      await probe(`ZQL (${label})`, `GET zql/executeSearch (${clause})`, async () => {
        try {
          const r = await runZql(`project = "${PROJECT_KEY}" AND ${clause}`);
          return { http: r.http, note: `${r.total} execution(s)` };
        } catch (e: any) {
          const msg = e?.response?.data?.errorDesc || e?.response?.data?.clauseQueryResult || e?.message;
          return { http: e?.response?.status ?? 0, note: `error: ${String(msg).slice(0, 90)}` };
        }
      });
    };
    // 10a. bare project ZQL — confirms the endpoint works and lets us harvest
    //      real cycleName/component values to test operator behavior against.
    let sampleCycleName = '';
    let sampleComponents: string[] = [];
    await probe('ZQL (project only)', 'GET /rest/zapi/latest/zql/executeSearch (project)', async () => {
      const r = await runZql(`project = "${PROJECT_KEY}"`);
      for (const ex of r.execs) {
        if (!sampleCycleName && ex.cycleName) sampleCycleName = ex.cycleName;
        const comps = Array.isArray(ex.components)
          ? ex.components.map((c: any) => c?.name ?? c).filter(Boolean)
          : [];
        for (const c of comps) if (!sampleComponents.includes(c)) sampleComponents.push(c);
      }
      return {
        http: r.http,
        note: `${r.total} exec; sample cycleName="${sampleCycleName}"; components=[${sampleComponents.slice(0, 4).join(', ')}]`,
      };
    });
    // 10b. Discovered ZQL syntax (validated live against the target server):
    //      - label keyword is `labels` (plural), NOT Jira's-looking `label`
    //      - status keyword is `executionStatus` with the NUMERIC code
    //        (1=PASS, 2=FAIL, 3=WIP, 4=BLOCKED, -1=UNEXECUTED); string names -> 406
    //      - `fixVersion` filters by release; clauses combine with AND/IN
    //      The tester's whole question ("label=modules not-run OR failed") is one call.
    for (const clause of [
      `labels = "${PROBE_LABEL}"`,
      `executionStatus = 2`,
      `fixVersion = "2026.2"`,
      `labels = "${PROBE_LABEL}" AND executionStatus IN (-1, 2)`,
    ]) {
      await probe(`ZQL (${clause})`, `GET zql/executeSearch (${clause})`, async () => {
        try {
          const r = await runZql(`project = "${PROJECT_KEY}" AND ${clause}`);
          return { http: r.http, note: `${r.total} execution(s)` };
        } catch (e: any) {
          const msg = e?.response?.data?.errorDesc || e?.response?.data?.clauseQueryResult || e?.message;
          return { http: e?.response?.status ?? 0, note: `error: ${String(msg).slice(0, 80)}` };
        }
      });
    }

    // 10c. QUESTION: is cycleName exact or contains/full-text?
    //      Compare `=` (exact) vs `~` (contains) vs a partial value "2026.2".
    //      If "2026.2" with `=` returns 0 but `~` returns many -> it's contains.
    if (sampleCycleName) {
      await tryZql('cycleName = <exact>', `cycleName = "${sampleCycleName}"`);
    }
    await tryZql('cycleName = "2026.2" (partial, exact op)', `cycleName = "2026.2"`);
    await tryZql('cycleName ~ "2026.2" (contains op)', `cycleName ~ "2026.2"`);

    // 10d. QUESTION: can component take multiple values (IN / array)?
    //      Test single `=`, `IN (a, b)`, and `~` contains behavior.
    if (sampleComponents.length) {
      await tryZql('component = <single>', `component = "${sampleComponents[0]}"`);
      if (sampleComponents.length >= 2) {
        await tryZql('component IN (a, b)', `component IN ("${sampleComponents[0]}", "${sampleComponents[1]}")`);
      }
      await tryZql('component ~ <partial>', `component ~ "${sampleComponents[0].slice(0, 3)}"`);
    }
    // multi-value labels and fixVersion via IN (relevant to array params)
    await tryZql('labels IN (a, b)', `labels IN ("${PROBE_LABEL}", "smoke")`);
    await tryZql('fixVersion IN (a, b)', `fixVersion IN ("2026.2", "2026.1")`);
    // cycleName IN with two exact names (Windows + Linux scenario needs multi-cycle)
    if (sampleComponents.length >= 2) {
      await tryZql('component IN (a, b) [retry]', `component IN ("${sampleComponents[0]}", "${sampleComponents[1]}")`);
    }

    // 10e. QUESTION (linked defects): does ZQL return defect issue keys for a
    //      FAILED execution? Needed to answer "linked defects / links to them".
    //      Find a failed modules execution and dump its defect-related fields.
    await probe('ZQL defect fields (dump)', 'GET zql/executeSearch (failed modules -> defects)', async () => {
      const r = await runZql(`project = "${PROJECT_KEY}" AND labels = "${PROBE_LABEL}" AND executionStatus = 2`);
      const withDefects = r.execs.find((e: any) => (e.totalDefectCount ?? 0) > 0) || r.execs[0];
      if (withDefects) {
        console.log('\n--- ZQL failed-execution defect fields ---');
        console.log(JSON.stringify({
          issueKey: withDefects.issueKey,
          totalDefectCount: withDefects.totalDefectCount,
          executionDefectCount: withDefects.executionDefectCount,
          stepDefectCount: withDefects.stepDefectCount,
          executionDefects: withDefects.executionDefects,
          stepDefects: withDefects.stepDefects,
          testDefectsUnMasked: withDefects.testDefectsUnMasked,
        }, null, 2));
        console.log('--- end defect fields ---\n');
      }
      const found = r.execs.filter((e: any) => (e.totalDefectCount ?? 0) > 0).length;
      return { http: r.http, note: `${r.total} failed; ${found}/${r.execs.length} sampled rows have defects` };
    });
  } else {
    skip('ZQL execution search', 'GET /rest/zapi/latest/zql/executeSearch', 'no projectId');
  }

  // ---- summary ----
  const ok = results.filter((r) => r.status === 'OK').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log('\n----------------------------------------');
  console.log(`Summary: ${ok} OK, ${fail} FAIL, ${skipped} SKIP  (of ${results.length})`);

  process.exit(fail > 0 ? 1 : 0);
};

main().catch((e) => {
  console.error('Probe crashed:', e?.message || e);
  process.exit(2);
});
