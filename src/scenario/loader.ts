import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ScenarioSchema, type Scenario } from './models.js';

export function loadScenario(filePath: string): Scenario {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = YAML.parse(content);
  return ScenarioSchema.parse(data);
}

export function loadScenarios(directory: string): Scenario[] {
  const entries = fs.readdirSync(directory).sort();
  const scenarios: Scenario[] = [];

  for (const entry of entries) {
    if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      scenarios.push(loadScenario(path.join(directory, entry)));
    }
  }

  return scenarios;
}
