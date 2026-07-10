/**
 * CAP-500 DIAGNOSTIC for GET /rest/zapi/latest/zql/executeSearch.
 *
 * READ-ONLY: GET requests only, safe against production.
 *
 * Goal: find out whether the `totalCount` / retrievable rows of the ZQL
 * execution search are capped server-side (the "suspicious round 500" another
 * client reported), and whether `offset` pagination actually lets us page past
 * that boundary. Answers three questions:
 *   Q1  Does totalCount change as maxRecords grows? (true total vs hidden cap)
 *   Q2  Can a single call return more than 500 rows? (maxRecords ceiling)
 *   Q3  Does offset paginate, and can we fetch rows at offset >= 500? (row cap)
 *
 * Run:  npm run diag-cap500     (add the script alias to package.json)
 *   or: npx tsx scripts/diag-cap500.ts
 *
 * Optional .env overrides:
 *   PROBE_PROJECT_KEY   project to query (default QA)
 *   PROBE_ZQL           full ZQL to probe instead of the bare project query
 *   PROBE_FIXVERSIONS   comma-separated versions -> fixVersion IN (...) probe
 *   PROBE_INSECURE_TLS / PROBE_USE_PROXY / PROBE_USER_AGENT  (as in check-api.ts)
 */
import { config as loadEnv } from 'dotenv';
import axios, { AxiosInstance } from 'axios';
import https from 'node:https';

loadEnv();

const BASE_URL = (process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
const USERNAME = process.env.JIRA_USERNAME || '';
const PASSWORD = process.env.JIRA_PASSWORD || process.env.JIRA_API_TOKEN || '';
const PROJECT_KEY = process.env.PROBE_PROJECT_KEY || 'QA';
const INSECURE_TLS = /^(1|true|yes)$/i.test(process.env.PROBE_INSECURE_TLS || '');
const USE_PROXY = /^(1|true|yes)$/i.test(process.env.PROBE_USE_PROXY || '');
const USER_AGENT =
  process.env.PROBE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

if (!BASE_URL || !USERNAME || !PASSWORD) {
  console.error('Missing JIRA_BASE_URL / JIRA_USERNAME / JIRA_PASSWORD in .env');
  process.exit(2);
}

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  auth: { username: USERNAME, password: PASSWORD },
  headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  timeout: 60000,
  proxy: USE_PROXY ? undefined : false,
  ...(INSECURE_TLS ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } : {}),
});

interface ZqlPage {
  http: number;
  totalCount: number | undefined;
  executionsCount: number | undefined;
  rows: number;
  firstId?: string;
  lastId?: string;
  ids: string[];
  err?: string;
}

const runZql = async (
  zqlQuery: string,
  params: { maxRecords?: number; offset?: number }
): Promise<ZqlPage> => {
  try {
    const { data, status } = await http.get('/rest/zapi/latest/zql/executeSearch', {
      params: { zqlQuery, ...params },
      validateStatus: () => true,
    });
    const execs: any[] = data?.executions ?? [];
    const ids = execs.map((e) => String(e.id));
    return {
      http: status,
      totalCount: data?.totalCount,
      executionsCount: data?.executionsCount,
      rows: execs.length,
      firstId: ids[0],
      lastId: ids[ids.length - 1],
      ids,
    };
  } catch (e: any) {
    return {
      http: e?.response?.status ?? 0,
      totalCount: undefined,
      executionsCount: undefined,
      rows: 0,
      ids: [],
      err: e?.response?.data?.errorDesc || e?.response?.data?.message || e?.message || String(e),
    };
  }
};

const fmt = (p: ZqlPage): string => {
  if (p.err) return `HTTP ${p.http}  ERROR: ${String(p.err).slice(0, 120)}`;
  return (
    `HTTP ${p.http}  totalCount=${p.totalCount ?? '?'}  executionsCount=${p.executionsCount ?? '?'}  ` +
    `rows=${p.rows}  first=${p.firstId ?? '-'}  last=${p.lastId ?? '-'}`
  );
};

const main = async (): Promise<void> => {
  const baseZql = process.env.PROBE_ZQL?.trim() || `project = "${PROJECT_KEY}"`;
  console.log(`\nCAP-500 diagnostic -> ${BASE_URL}`);
  console.log(`ZQL: ${baseZql}\n`);

  // --- Q1: does totalCount move as maxRecords grows? -----------------------
  console.log('== Q1: totalCount vs maxRecords (is total itself capped?) ==');
  const maxRecordsLadder = [50, 100, 200, 500, 501, 1000, 2000, 5000];
  const q1: Record<number, ZqlPage> = {};
  for (const mr of maxRecordsLadder) {
    const p = await runZql(baseZql, { maxRecords: mr });
    q1[mr] = p;
    console.log(`  maxRecords=${String(mr).padStart(4)}  ->  ${fmt(p)}`);
  }

  const totals = maxRecordsLadder.map((mr) => q1[mr]?.totalCount).filter((t) => t !== undefined);
  const distinctTotals = [...new Set(totals)];
  const maxRows = Math.max(...maxRecordsLadder.map((mr) => q1[mr]?.rows ?? 0));

  // --- Q3: offset pagination, especially past 500 --------------------------
  console.log('\n== Q3: offset pagination (can we page past 500?) ==');
  const offsetLadder = [0, 50, 100, 450, 490, 500, 550, 1000];
  const pageSize = 50;
  const seen = new Map<string, number>(); // id -> first offset it appeared at
  let overlap = 0;
  for (const off of offsetLadder) {
    const p = await runZql(baseZql, { maxRecords: pageSize, offset: off });
    let dupInThisPage = 0;
    for (const id of p.ids) {
      if (seen.has(id)) dupInThisPage++;
      else seen.set(id, off);
    }
    overlap += dupInThisPage;
    console.log(
      `  offset=${String(off).padStart(4)}  ->  ${fmt(p)}  (new-vs-prev-pages dup=${dupInThisPage})`
    );
  }

  // --- optional: reproduce the fixVersion IN (...) case --------------------
  const fvRaw = process.env.PROBE_FIXVERSIONS?.trim();
  if (fvRaw) {
    const versions = fvRaw.split(',').map((v) => v.trim()).filter(Boolean);
    const inList = versions.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(', ');
    const fvZql = `project = "${PROJECT_KEY}" AND fixVersion IN (${inList})`;
    console.log(`\n== fixVersion IN probe (reproduce the reported 500) ==`);
    console.log(`ZQL: ${fvZql}`);
    for (const mr of [50, 500, 1000, 2000]) {
      const p = await runZql(fvZql, { maxRecords: mr });
      console.log(`  maxRecords=${String(mr).padStart(4)}  ->  ${fmt(p)}`);
    }
  }

  // --- verdict -------------------------------------------------------------
  console.log('\n----------------------------------------');
  console.log('VERDICT');
  console.log(`  distinct totalCount values across maxRecords ladder: [${distinctTotals.join(', ')}]`);
  if (distinctTotals.length === 1) {
    const t = distinctTotals[0]!;
    if ([500, 1000, 2000].includes(t) && maxRows < t) {
      console.log(`  -> totalCount is STABLE at ${t} but we never retrieved that many rows.`);
      console.log(`     If ${t} is a round number and real data is larger, this is a HIDDEN CAP.`);
    } else {
      console.log(`  -> totalCount STABLE at ${t}; consistent with a genuine total (not a maxRecords artifact).`);
    }
  } else {
    console.log(`  -> totalCount CHANGES with maxRecords -> it reflects returned rows, not the true match count.`);
  }
  console.log(`  max rows ever returned in ONE call: ${maxRows}`);
  const past500 = offsetLadder.filter((o) => o >= 500 && (seen.size, true));
  const anyRowsPast500 = [...seen.values()].some((firstOff) => firstOff >= 500);
  console.log(`  offset>=500 returned NEW rows: ${anyRowsPast500 ? 'YES (can page past 500)' : 'NO (hard 500 row ceiling)'}`);
  console.log(`  cross-page duplicate rows via offset: ${overlap} (0 = clean pagination)`);
  void past500;
};

main().catch((e) => {
  console.error('diagnostic crashed:', e?.message || e);
  process.exit(2);
});
