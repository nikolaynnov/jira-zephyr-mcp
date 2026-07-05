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
  executedBy?: string;
  executedByDisplay?: string;
  assignedTo?: string;
  assignedToDisplay?: string;
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
