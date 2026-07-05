// Test Plans do not exist in Zephyr for JIRA 5.6.3 (Zephyr Squad Server). They
// are a Zephyr Scale Cloud concept. These tools are kept only to return a clear
// "not supported" message so callers get an explicit answer.
import { notSupportedOnPlatform } from '../utils/tool-status.js';

export const createTestPlan = async (_input: unknown) => {
  return notSupportedOnPlatform('Test plans (create_test_plan)');
};

export const listTestPlans = async (_input: unknown) => {
  return notSupportedOnPlatform('Test plans (list_test_plans)');
};
