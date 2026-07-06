// Types for the "JIRA 8.12 Server + Zephyr for JIRA 5.6.3 (ZAPI)" fork.
//
// Two layers are modeled:
//  - Raw* : the shapes ZAPI actually returns (verified against a live server).
//  - normalized types the MCP tools return, kept stable and platform-neutral.

// ---- ZAPI execution status ------------------------------------------------

// Numeric status ids used by ZAPI executions (see /execution "status" map).
export const ZAPI_EXECUTION_STATUS: Record<string, string> = {
  '1': 'PASS',
  '2': 'FAIL',
  '3': 'WIP',
  '4': 'BLOCKED',
  '-1': 'UNEXECUTED',
};

// Reverse map (status name -> numeric id) used to build ZQL executionStatus
// clauses. ZQL rejects the string names with HTTP 406, so callers pass
// human-readable names that we translate to numeric codes.
export const ZAPI_STATUS_NAME_TO_ID: Record<string, number> = {
  PASS: 1,
  FAIL: 2,
  WIP: 3,
  BLOCKED: 4,
  UNEXECUTED: -1,
};

// ---- Raw ZAPI shapes ------------------------------------------------------

export interface RawZapiCycle {
  name?: string;
  description?: string;
  versionId?: number | string;
  versionName?: string;
  projectId?: number | string;
  projectKey?: string;
  environment?: string;
  build?: string;
  startDate?: string;
  endDate?: string;
  createdDate?: string;
  createdBy?: string;
  createdByDisplay?: string;
  modifiedBy?: string;
  totalExecutions?: number;
  totalExecuted?: number;
  totalCycleExecutions?: number;
  totalDefects?: number;
}

// GET /rest/zapi/latest/cycle returns a map keyed by cycleId plus some meta keys.
export type RawZapiCycleMap = Record<string, RawZapiCycle | number | string>;

export interface RawZapiExecution {
  id: number | string;
  orderId?: number;
  executionStatus: string;
  issueId?: number | string;
  issueKey?: string;
  summary?: string;
  label?: string;
  component?: string;
  comment?: string;
  htmlComment?: string;
  cycleId?: number | string;
  cycleName?: string;
  versionId?: number | string;
  versionName?: string;
  projectId?: number | string;
  projectKey?: string;
  executedOn?: string;
  executedOnVal?: number;
  executedBy?: string;
  executedByDisplay?: string;
  assignedTo?: string;
  assignedToDisplay?: string;
  stepDefectCount?: number;
}

export interface RawZapiStatus {
  id: number;
  name: string;
  color?: string;
  description?: string;
}

export interface RawZapiExecutionResponse {
  status: Record<string, RawZapiStatus>;
  executions: RawZapiExecution[];
  totalExecutions?: number;
  totalExecuted?: number;
  recordsCount?: number;
}

// GET /rest/zapi/latest/zql/executeSearch returns a different execution shape
// than /execution: labels is a string[], components is an object[], status is
// an object, and there is no executedOnVal (only executedOn/creationDate).
export interface RawZqlComponent {
  id?: number | string;
  name?: string;
}

export interface RawZqlExecution {
  id: number | string;
  orderId?: number;
  cycleId?: number | string;
  cycleName?: string;
  issueId?: number | string;
  issueKey?: string;
  issueSummary?: string;
  labels?: string[];
  projectKey?: string;
  projectId?: number | string;
  priority?: string;
  components?: RawZqlComponent[];
  versionId?: number | string;
  versionName?: string;
  status?: RawZapiStatus;
  executionStatus?: number | string;
  executedOn?: string;
  creationDate?: string;
  executedBy?: string;
  executedByDisplay?: string;
  comment?: string;
  // Linked defects, returned inline by ZQL for failed/blocked executions.
  // executionDefects are rich objects; stepDefects/testDefectsUnMasked are
  // usually bare issue keys. Counts are provided separately by the server.
  executionDefects?: RawZqlDefect[];
  stepDefects?: Array<RawZqlDefect | string>;
  testDefectsUnMasked?: Array<RawZqlDefect | string>;
  totalDefectCount?: number;
  executionDefectCount?: number;
  stepDefectCount?: number;
}

export interface RawZqlDefect {
  defectId?: number | string;
  defectKey?: string;
  defectSummary?: string;
  defectStatus?: string;
  defectResolutionId?: string;
}

export interface RawZqlExecutionResponse {
  executions: RawZqlExecution[];
  totalCount?: number;
  executionsCount?: number;
  currentIndex?: number;
  maxResultsAllowed?: number;
}

export interface RawZapiTestStep {
  id: number;
  orderId: number;
  step: string;
  data?: string;
  result?: string;
  htmlStep?: string;
  htmlData?: string;
  htmlResult?: string;
}

export interface RawZapiTestStepResponse {
  stepBeanCollection: RawZapiTestStep[];
}

export interface RawZapiVersionOption {
  value: string;
  label: string;
  archived: boolean;
}

export interface RawZapiVersionBoard {
  unreleasedVersions?: RawZapiVersionOption[];
  releasedVersions?: RawZapiVersionOption[];
}

// ---- Normalized shapes returned by the tools ------------------------------

export interface ZephyrExecutionSummary {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  inProgress: number;
  notExecuted: number;
  passRate: number;
}

export interface ZephyrTestCycle {
  id: string;
  name: string;
  description?: string;
  projectId: string;
  projectKey?: string;
  versionId: string;
  versionName?: string;
  environment?: string;
  build?: string;
  totalExecutions: number;
  totalExecuted: number;
  createdBy?: string;
  createdOn?: string;
  executionSummary: ZephyrExecutionSummary;
}

export interface ZephyrTestExecution {
  id: string;
  status: string;
  statusName?: string;
  issueId?: string;
  issueKey?: string;
  summary?: string;
  comment?: string;
  executedOn?: string;
  executedBy?: string;
  cycleId?: string;
  cycleName?: string;
  versionName?: string;
  stepDefectCount?: string;
}

// A single row returned by the ZQL execution search (search_test_executions).
// Unlike ZephyrTestExecution it carries the test case's labels/components,
// because ZQL returns them inline and testers filter/group on them.
export interface ZephyrExecutionSearchRow {
  id: string;
  status: string;
  statusName?: string;
  issueId?: string;
  issueKey?: string;
  summary?: string;
  labels: string[];
  components: string[];
  priority?: string;
  cycleId?: string;
  cycleName?: string;
  versionName?: string;
  executedOn?: string;
  executedBy?: string;
  // Distinct defect issue keys linked to this failed/blocked execution
  // (merged from executionDefects, stepDefects, testDefectsUnMasked).
  // Empty array when the execution has no linked defects.
  defectKeys: string[];
  defects: ZephyrLinkedDefect[];
}

export interface ZephyrLinkedDefect {
  key: string;
  summary?: string;
  status?: string;
  url?: string;
}

export interface ZephyrExecutionSearchResult {
  total: number;
  count: number;
  zql: string;
  executions: ZephyrExecutionSearchRow[];
}

export interface ZephyrTestStep {
  id: number;
  orderId: number;
  description: string;
  testData?: string;
  expectedResult?: string;
}

// A Zephyr Squad test case is a JIRA issue of the "Test" type.
export interface ZephyrTestCase {
  id: string;
  key: string;
  name: string;
  objective?: string;
  precondition?: string;
  status?: string;
  priority?: string;
  labels: string[];
  components: string[];
  project?: {
    key?: string;
    name?: string;
  };
  createdOn?: string;
  steps: ZephyrTestStep[];
  // Optional execution history (populated only when explicitly requested).
  // executions are ordered newest-first, so lastExecution mirrors executions[0].
  lastExecution?: ZephyrTestExecution;
  executions?: ZephyrTestExecution[];
}

export interface ZephyrTestReport {
  cycleId: string;
  cycleName?: string;
  projectId?: string;
  versionName?: string;
  summary: ZephyrExecutionSummary;
  executions: ZephyrTestExecution[];
  generatedOn: string;
}

// ---- defect linking (write) --------------------------------------------

// GET /rest/zapi/latest/execution/{execId} returns a single execution, either
// bare or wrapped as { execution: {...} }. Only the fields needed to build the
// /execute PUT body and to merge the current defect list are modeled here.
export interface RawZapiExecutionDefect {
  key?: string;
  defectKey?: string;
}

export interface RawZapiSingleExecution {
  id?: number | string;
  issueId?: number | string;
  issueKey?: string;
  cycleId?: number | string;
  cycleName?: string;
  defects?: Array<RawZapiExecutionDefect | string>;
  defectList?: string[];
}

export interface RawZapiSingleExecutionResponse {
  execution?: RawZapiSingleExecution;
}

// Resolved execution context needed to attach defects: the execution id, the
// Test issue id (required in the /execute body), and the current defect keys
// (used to merge instead of overwrite).
export interface ResolvedExecutionForDefects {
  executionId: string;
  issueId: string;
  issueKey?: string;
  cycleName?: string;
  currentDefects: string[];
}

// Outcome of attaching defects to one target (an execution or a step result).
export interface DefectLinkTargetResult {
  target: 'execution' | 'stepResult';
  id: string;
  before: string[];
  after: string[];
  added: string[];
  written: boolean;
  error?: string;
}

