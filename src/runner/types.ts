import type { Scenario, ScenarioResult } from '../scenario/models.js';

export interface IScenarioRunner {
  run(scenario: Scenario): Promise<ScenarioResult>;
}
