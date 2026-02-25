import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadScenario, loadScenarios } from '../../src/scenario/loader.js';

const SCENARIOS_DIR = path.resolve(import.meta.dirname, '..', '..', 'scenarios');

describe('loadScenario', () => {
  it('loads a single YAML scenario', () => {
    const scenario = loadScenario(path.join(SCENARIOS_DIR, 'example_code_review.yaml'));
    expect(scenario.name).toBe('code_review_routing');
    expect(scenario.tools.length).toBeGreaterThan(0);
    expect(scenario.expectedCalls.length).toBeGreaterThan(0);
    expect(scenario.messages.length).toBe(1);
  });

  it('has context budget', () => {
    const scenario = loadScenario(path.join(SCENARIOS_DIR, 'example_code_review.yaml'));
    expect(scenario.contextBudget.maxInputTokens).toBe(50000);
    expect(scenario.contextBudget.maxTurns).toBe(5);
  });

  it('has forbidden calls', () => {
    const scenario = loadScenario(path.join(SCENARIOS_DIR, 'example_code_review.yaml'));
    expect(scenario.forbiddenCalls.length).toBe(1);
    expect(scenario.forbiddenCalls[0].name).toBe('Write');
  });
});

describe('loadScenarios', () => {
  it('loads all scenarios from directory', () => {
    const scenarios = loadScenarios(SCENARIOS_DIR);
    expect(scenarios.length).toBeGreaterThanOrEqual(3);
    const names = new Set(scenarios.map((s) => s.name));
    expect(names.has('code_review_routing')).toBe(true);
    expect(names.has('agent_delegation_explore')).toBe(true);
    expect(names.has('skill_invocation_commit')).toBe(true);
  });
});
