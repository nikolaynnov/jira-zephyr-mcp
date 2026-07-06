import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { readJiraIssue } from './tools/jira-issues.js';
import { createTestCycle, listTestCycles } from './tools/test-cycles.js';
import {
  executeTest,
  getTestExecutionStatus,
  listTestCycleExecutions,
  searchTestExecutions,
  linkTestsToIssues,
  generateTestReport,
} from './tools/test-execution.js';
import {
  createTestCase,
  searchTestCases,
  getTestCase,
  getTestCaseExecutions,
  createMultipleTestCases,
} from './tools/test-cases.js';
import {
  readJiraIssueSchema,
  createTestCycleSchema,
  listTestCyclesSchema,
  executeTestSchema,
  getTestExecutionStatusSchema,
  listTestCycleExecutionsSchema,
  searchTestExecutionsSchema,
  linkTestsToIssuesSchema,
  generateTestReportSchema,
  createTestCaseSchema,
  searchTestCasesSchema,
  getTestCaseSchema,
  getTestCaseExecutionsSchema,
  createMultipleTestCasesSchema,
  ReadJiraIssueInput,
  CreateTestCycleInput,
  ListTestCyclesInput,
  ExecuteTestInput,
  GetTestExecutionStatusInput,
  ListTestCycleExecutionsInput,
  SearchTestExecutionsInput,
  LinkTestsToIssuesInput,
  GenerateTestReportInput,
  CreateTestCaseInput,
  SearchTestCasesInput,
  GetTestCaseInput,
  GetTestCaseExecutionsInput,
  CreateMultipleTestCasesInput,
} from './utils/validation.js';

const server = new Server(
  {
    name: 'jira-zephyr-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
  }
);

const TOOLS = [
  {
    name: 'read_jira_issue',
    annotations: { readOnlyHint: true },
    description: 'Read JIRA issue details and metadata',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: { type: 'string', description: 'JIRA issue key (e.g., ABC-123)' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Specific fields to retrieve (optional)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'create_test_cycle',
    description: '[READ-ONLY ITERATION] Not implemented yet in this fork. Returns a read-only-iteration error.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Test cycle name' },
        description: { type: 'string', description: 'Test cycle description (optional)' },
        projectKey: { type: 'string', description: 'JIRA project key' },
        versionId: { type: 'string', description: 'JIRA version ID' },
        environment: { type: 'string', description: 'Test environment (optional)' },
        startDate: { type: 'string', description: 'Planned start date (ISO format, optional)' },
        endDate: { type: 'string', description: 'Planned end date (ISO format, optional)' },
      },
      required: ['name', 'projectKey', 'versionId'],
    },
  },
  {
    name: 'list_test_cycles',
    annotations: { readOnlyHint: true },
    description: 'List Zephyr Squad test cycles for a project (optionally filtered by version) with execution status',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string', description: 'JIRA project key' },
        versionId: { type: 'string', description: 'JIRA version ID (optional)' },
        limit: { type: 'number', description: 'Maximum number of results (default: 50)' },
      },
      required: ['projectKey'],
    },
  },
  {
    name: 'execute_test',
    description: '[READ-ONLY ITERATION] Not implemented yet in this fork. Returns a read-only-iteration error.',
    inputSchema: {
      type: 'object',
      properties: {
        executionId: { type: 'string', description: 'Test execution ID' },
        status: { type: 'string', enum: ['PASS', 'FAIL', 'WIP', 'BLOCKED'], description: 'Execution status' },
        comment: { type: 'string', description: 'Execution comment (optional)' },
        defects: { type: 'array', items: { type: 'string' }, description: 'Linked defect keys (optional)' },
      },
      required: ['executionId', 'status'],
    },
  },
  {
    name: 'get_test_execution_status',
    annotations: { readOnlyHint: true },
    description: 'Get aggregate execution progress and statistics for a test cycle (pass/fail/blocked counts and pass rate). For the per-test execution list use list_test_cycle_executions.',
    inputSchema: {
      type: 'object',
      properties: {
        cycleId: { type: 'string', description: 'Test cycle ID' },
      },
      required: ['cycleId'],
    },
  },
  {
    name: 'list_test_cycle_executions',
    annotations: { readOnlyHint: true },
    description: 'List individual test executions inside a test cycle (each test with its status, executed date, executor and comment). Use this to see WHICH tests ran in a cycle, not just the totals.',
    inputSchema: {
      type: 'object',
      properties: {
        cycleId: { type: 'string', description: 'Test cycle ID' },
        projectKey: { type: 'string', description: 'JIRA project key (optional, improves lookup accuracy)' },
        versionId: { type: 'string', description: 'JIRA version ID (optional)' },
      },
      required: ['cycleId'],
    },
  },
  {
    name: 'link_tests_to_issues',
    description: '[READ-ONLY ITERATION] Not implemented yet in this fork. Returns a read-only-iteration error.',
    inputSchema: {
      type: 'object',
      properties: {
        testCaseId: { type: 'string', description: 'Test case ID' },
        issueKeys: { type: 'array', items: { type: 'string' }, description: 'JIRA issue keys to link' },
      },
      required: ['testCaseId', 'issueKeys'],
    },
  },
  {
    name: 'generate_test_report',
    annotations: { readOnlyHint: true },
    description: 'Generate a test execution report for a cycle. JSON format includes the full list of executions (issue key, status, executed date, version) plus a summary; HTML format renders a human-readable page.',
    inputSchema: {
      type: 'object',
      properties: {
        cycleId: { type: 'string', description: 'Test cycle ID' },
        format: { type: 'string', enum: ['JSON', 'HTML'], description: 'Report format (default: JSON)' },
      },
      required: ['cycleId'],
    },
  },
  {
    name: 'create_test_case',
    description: '[READ-ONLY ITERATION] Not implemented yet in this fork. Returns a read-only-iteration error.',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string', description: 'JIRA project key' },
        name: { type: 'string', description: 'Test case name' },
        objective: { type: 'string', description: 'Test case objective/description (optional)' },
        precondition: { type: 'string', description: 'Test preconditions (optional)' },
        estimatedTime: { type: 'number', description: 'Estimated execution time in minutes (optional)' },
        priority: { type: 'string', description: 'Test case priority (optional)' },
        status: { type: 'string', description: 'Test case status (optional)' },
        folderId: { type: 'string', description: 'Folder ID to organize test case (optional)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Test case labels (optional)' },
        componentId: { type: 'string', description: 'Component ID (optional)' },
        customFields: { type: 'object', description: 'Custom fields as key-value pairs (optional)' },
        testScript: {
          type: 'object',
          description: 'Test script with steps (optional)',
          properties: {
            type: { type: 'string', enum: ['STEP_BY_STEP', 'PLAIN_TEXT'], description: 'Script type' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'number', description: 'Step number' },
                  description: { type: 'string', description: 'Step description' },
                  testData: { type: 'string', description: 'Test data (optional)' },
                  expectedResult: { type: 'string', description: 'Expected result' },
                },
                required: ['index', 'description', 'expectedResult'],
              },
              description: 'Test steps (for STEP_BY_STEP type)',
            },
            text: { type: 'string', description: 'Plain text script (for PLAIN_TEXT type)' },
          },
          required: ['type'],
        },
      },
      required: ['projectKey', 'name'],
    },
  },
  {
    name: 'search_test_cases',
    annotations: { readOnlyHint: true },
    description: 'Search test cases (JIRA issues of the Test type) in a project using structured filters. All filters are optional and combine with AND. Note: `text` is a free-text keyword match on summary/description (NOT JQL); use `labels`/`components` for exact filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string', description: 'JIRA project key' },
        text: { type: 'string', description: 'Free-text keyword match on summary/description (optional, NOT a JQL string)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Exact label filter — matches test cases having ANY of these labels (optional)' },
        components: { type: 'array', items: { type: 'string' }, description: 'Exact component filter — matches test cases having ANY of these components (optional)' },
        limit: { type: 'number', description: 'Maximum number of results (default: 50)' },
      },
      required: ['projectKey'],
    },
  },
  {
    name: 'get_test_case',
    annotations: { readOnlyHint: true },
    description: 'Get a test case (JIRA Test issue) with its Zephyr test steps. Set includeExecutions to also return its execution history (last execution + all runs across cycles).',
    inputSchema: {
      type: 'object',
      properties: {
        testCaseId: { type: 'string', description: 'Test case issue key (e.g. QA-240) or issue id' },
        includeExecutions: { type: 'boolean', description: 'Include execution history (last run + all runs across cycles). Default: false', default: false },
      },
      required: ['testCaseId'],
    },
  },
  {
    name: 'get_test_case_executions',
    annotations: { readOnlyHint: true },
    description: 'Get the execution history of a single test case across all cycles (newest first): status, executed date, executor, cycle and version/release. Also returns the test case labels and components once at the top level. Use this to answer "when was this test last run and for which release?".',
    inputSchema: {
      type: 'object',
      properties: {
        testCaseId: { type: 'string', description: 'Test case issue key (e.g. QA-1246) or issue id' },
      },
      required: ['testCaseId'],
    },
  },
  {
    name: 'search_test_executions',
    annotations: { readOnlyHint: true },
    description: 'Search test EXECUTIONS (runs) server-side via ZQL (Zephyr Query Language), which queries executions rather than issues. All structured filters are optional and combine with AND; array filters match ANY of their values. Each returned execution includes any LINKED DEFECTS (defectKeys + defects[] with key/summary/status). IMPORTANT: if `zql` is provided, ALL structured filters are ignored and the raw ZQL is used as-is.',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string', description: 'JIRA project key (required unless a fully-qualified zql is given, but still recommended)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Match executions of test cases having ANY of these labels (exact)' },
        components: { type: 'array', items: { type: 'string' }, description: 'Match ANY of these components (exact)' },
        status: { type: 'array', items: { type: 'string', enum: ['PASS', 'FAIL', 'WIP', 'BLOCKED', 'UNEXECUTED'] }, description: 'Match ANY of these execution statuses (human names are translated to Zephyr numeric codes)' },
        fixVersions: { type: 'array', items: { type: 'string' }, description: 'Match ANY of these fix versions / releases (exact, e.g. "2026.2")' },
        cycleNameContains: { type: 'string', description: 'Substring match on cycle name, e.g. "2026.2" matches "Linux ... 2026.2", "Windows ... 2026.2"' },
        cycleNames: { type: 'array', items: { type: 'string' }, description: 'Exact cycle names (use when you know the full cycle titles)' },
        zql: { type: 'string', description: 'Raw ZQL escape hatch for power users. When set, this takes PRIORITY and all structured filters above are IGNORED. Example: project = "QA" AND labels = "modules" AND executionStatus IN (-1, 2)' },
        limit: { type: 'number', description: 'Maximum number of executions to return (default: 50)' },
      },
      required: ['projectKey'],
    },
  },
  {
    name: 'create_multiple_test_cases',
    description: '[READ-ONLY ITERATION] Not implemented yet in this fork. Returns a read-only-iteration error.',
    inputSchema: {
      type: 'object',
      properties: {
        testCases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              projectKey: { type: 'string', description: 'JIRA project key' },
              name: { type: 'string', description: 'Test case name' },
              objective: { type: 'string', description: 'Test case objective/description (optional)' },
              precondition: { type: 'string', description: 'Test preconditions (optional)' },
              estimatedTime: { type: 'number', description: 'Estimated execution time in minutes (optional)' },
              priority: { type: 'string', description: 'Test case priority (optional)' },
              status: { type: 'string', description: 'Test case status (optional)' },
              folderId: { type: 'string', description: 'Folder ID to organize test case (optional)' },
              labels: { type: 'array', items: { type: 'string' }, description: 'Test case labels (optional)' },
              componentId: { type: 'string', description: 'Component ID (optional)' },
              customFields: { type: 'object', description: 'Custom fields as key-value pairs (optional)' },
              testScript: {
                type: 'object',
                description: 'Test script with steps (optional)',
                properties: {
                  type: { type: 'string', enum: ['STEP_BY_STEP', 'PLAIN_TEXT'], description: 'Script type' },
                  steps: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        index: { type: 'number', description: 'Step number' },
                        description: { type: 'string', description: 'Step description' },
                        testData: { type: 'string', description: 'Test data (optional)' },
                        expectedResult: { type: 'string', description: 'Expected result' },
                      },
                      required: ['index', 'description', 'expectedResult'],
                    },
                    description: 'Test steps (for STEP_BY_STEP type)',
                  },
                  text: { type: 'string', description: 'Plain text script (for PLAIN_TEXT type)' },
                },
                required: ['type'],
              },
            },
            required: ['projectKey', 'name'],
          },
          description: 'Array of test cases to create',
        },
        continueOnError: { type: 'boolean', description: 'Continue creating remaining test cases if one fails (default: true)', default: true },
      },
      required: ['testCases'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

const validateInput = <T>(schema: any, input: unknown, toolName: string): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    const errors = result.error.errors.map((err: any) => `${err.path.join('.')}: ${err.message}`);
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid parameters for ${toolName}:\n${errors.join('\n')}`
    );
  }
  return result.data as T;
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case 'read_jira_issue': {
        const validatedArgs = validateInput<ReadJiraIssueInput>(readJiraIssueSchema, args, 'read_jira_issue');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await readJiraIssue(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'create_test_cycle': {
        const validatedArgs = validateInput<CreateTestCycleInput>(createTestCycleSchema, args, 'create_test_cycle');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await createTestCycle(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'list_test_cycles': {
        const validatedArgs = validateInput<ListTestCyclesInput>(listTestCyclesSchema, args, 'list_test_cycles');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await listTestCycles(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'execute_test': {
        const validatedArgs = validateInput<ExecuteTestInput>(executeTestSchema, args, 'execute_test');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await executeTest(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'get_test_execution_status': {
        const validatedArgs = validateInput<GetTestExecutionStatusInput>(getTestExecutionStatusSchema, args, 'get_test_execution_status');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await getTestExecutionStatus(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'list_test_cycle_executions': {
        const validatedArgs = validateInput<ListTestCycleExecutionsInput>(listTestCycleExecutionsSchema, args, 'list_test_cycle_executions');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await listTestCycleExecutions(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'search_test_executions': {
        const validatedArgs = validateInput<SearchTestExecutionsInput>(searchTestExecutionsSchema, args, 'search_test_executions');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await searchTestExecutions(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'link_tests_to_issues': {
        const validatedArgs = validateInput<LinkTestsToIssuesInput>(linkTestsToIssuesSchema, args, 'link_tests_to_issues');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await linkTestsToIssues(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'generate_test_report': {
        const validatedArgs = validateInput<GenerateTestReportInput>(generateTestReportSchema, args, 'generate_test_report');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await generateTestReport(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'create_test_case': {
        const validatedArgs = validateInput<CreateTestCaseInput>(createTestCaseSchema, args, 'create_test_case');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await createTestCase(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'search_test_cases': {
        const validatedArgs = validateInput<SearchTestCasesInput>(searchTestCasesSchema, args, 'search_test_cases');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await searchTestCases(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'get_test_case': {
        const validatedArgs = validateInput<GetTestCaseInput>(getTestCaseSchema, args, 'get_test_case');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await getTestCase(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'get_test_case_executions': {
        const validatedArgs = validateInput<GetTestCaseExecutionsInput>(getTestCaseExecutionsSchema, args, 'get_test_case_executions');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await getTestCaseExecutions(validatedArgs), null, 2),
            },
          ],
        };
      }

      case 'create_multiple_test_cases': {
        const validatedArgs = validateInput<CreateMultipleTestCasesInput>(createMultipleTestCasesSchema, args, 'create_multiple_test_cases');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await createMultipleTestCases(validatedArgs), null, 2),
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, `Error executing tool '${name}': ${errorMessage}`);
  }
});

async function main() {
  try {
    console.error('Starting Jira Zephyr MCP server...');
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('Jira Zephyr MCP server running...');
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.error('Received SIGINT, shutting down gracefully...');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.error('Received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });

    // Keep the process alive
    await new Promise(() => {});
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Failed to start MCP server:', errorMessage);
    if (errorMessage.includes('Configuration validation failed')) {
      console.error('Please check your environment variables and try again.');
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error during server startup:', err);
  process.exit(1);
});