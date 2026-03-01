import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadScenario, loadScenarios } from '../../src/scenario/loader.js';

const DOMAIN_DIR = path.resolve(import.meta.dirname, '..', '..', 'scenarios', 'domain');

describe('loadScenario', () => {
  it('loads a single YAML scenario', () => {
    const scenario = loadScenario(path.join(DOMAIN_DIR, 'single_domain_order.yaml'));
    expect(scenario.name).toBe('single_domain_order_routing');
    expect(scenario.tools.length).toBeGreaterThan(0);
    expect(scenario.expectedCalls.length).toBeGreaterThan(0);
    expect(scenario.messages.length).toBe(1);
  });

  it('has context budget', () => {
    const scenario = loadScenario(path.join(DOMAIN_DIR, 'single_domain_order.yaml'));
    expect(scenario.contextBudget.maxTotalTokens).toBe(40000);
    expect(scenario.contextBudget.maxTurns).toBe(3);
  });

  it('has forbidden calls', () => {
    const scenario = loadScenario(path.join(DOMAIN_DIR, 'single_domain_order.yaml'));
    expect(scenario.forbiddenCalls.length).toBe(2);
    expect(scenario.forbiddenCalls[0].name).toBe('domain-orchestrator');
    expect(scenario.forbiddenCalls[1].name).toBe('Read');
  });
});

describe('loadScenarios', () => {
  it('loads all scenarios from directory', () => {
    const scenarios = loadScenarios(DOMAIN_DIR);
    expect(scenarios.length).toBeGreaterThanOrEqual(14);
    const names = new Set(scenarios.map((s) => s.name));
    expect(names.has('single_domain_order_routing')).toBe(true);
    expect(names.has('multi_domain_order_payment_routing')).toBe(true);
    expect(names.has('single_domain_member_routing')).toBe(true);
  });
});
