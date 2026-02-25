import { describe, it, expect } from 'vitest';
import { classifyCall } from '../../src/runner/classify-call.js';

describe('classifyCall', () => {
  it('classifies regular tool', () => {
    const [callType, name] = classifyCall('Read', { file_path: 'a.py' });
    expect(callType).toBe('tool');
    expect(name).toBe('Read');
  });

  it('classifies Task as agent', () => {
    const [callType, name] = classifyCall('Task', {
      subagent_type: 'Explore',
      prompt: 'find files',
    });
    expect(callType).toBe('agent');
    expect(name).toBe('Explore');
  });

  it('classifies Skill call', () => {
    const [callType, name] = classifyCall('Skill', { skill: 'commit' });
    expect(callType).toBe('skill');
    expect(name).toBe('commit');
  });

  it('handles Task without subagent_type', () => {
    const [callType, name] = classifyCall('Task', { prompt: 'do something' });
    expect(callType).toBe('agent');
    expect(name).toBe('unknown');
  });
});
