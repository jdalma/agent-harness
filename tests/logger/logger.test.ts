import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../../src/logger/logger.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('quiet 레벨', () => {
    it('scenarioStart에서 아무것도 출력하지 않는다', () => {
      const logger = new Logger('quiet');
      logger.scenarioStart('test-scenario', 1, 3);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('scenarioEnd에서 아무것도 출력하지 않는다', () => {
      const logger = new Logger('quiet');
      logger.scenarioEnd('test-scenario', 'pass', 1234);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('turn에서 아무것도 출력하지 않는다', () => {
      const logger = new Logger('quiet');
      logger.turn('test-scenario', 1);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('toolCall에서 아무것도 출력하지 않는다', () => {
      const logger = new Logger('quiet');
      logger.toolCall('tool', 'Read', 0);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('info에서 아무것도 출력하지 않는다', () => {
      const logger = new Logger('quiet');
      logger.info('some message');
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe('normal 레벨', () => {
    it('scenarioStart에서 시나리오 번호와 이름을 출력한다', () => {
      const logger = new Logger('normal');
      logger.scenarioStart('my-scenario', 2, 5);
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('[2/5]');
      expect(output).toContain('my-scenario');
    });

    it('scenarioEnd에서 verdict와 소요시간을 출력한다', () => {
      const logger = new Logger('normal');
      logger.scenarioEnd('my-scenario', 'pass', 1500);
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('PASS');
      expect(output).toContain('my-scenario');
      expect(output).toContain('1500ms');
    });

    it('turn은 normal 레벨에서 출력하지 않는다', () => {
      const logger = new Logger('normal');
      logger.turn('my-scenario', 1);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('toolCall은 normal 레벨에서 출력하지 않는다', () => {
      const logger = new Logger('normal');
      logger.toolCall('tool', 'Read', 0);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('info에서 메시지를 출력한다', () => {
      const logger = new Logger('normal');
      logger.info('결과 저장: results/test.json');
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('결과 저장: results/test.json');
    });
  });

  describe('verbose 레벨', () => {
    it('scenarioStart에서 출력한다', () => {
      const logger = new Logger('verbose');
      logger.scenarioStart('my-scenario', 1, 3);
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('[1/3]');
      expect(output).toContain('my-scenario');
    });

    it('turn에서 턴 번호를 출력한다', () => {
      const logger = new Logger('verbose');
      logger.turn('my-scenario', 2);
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('Turn 2');
    });

    it('toolCall에서 타입과 이름을 출력한다', () => {
      const logger = new Logger('verbose');
      logger.toolCall('agent', 'order', 1);
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('T1');
      expect(output).toContain('agent:order');
    });
  });

  describe('기본 레벨', () => {
    it('인자 없이 생성하면 normal 레벨이다', () => {
      const logger = new Logger();
      logger.scenarioStart('test', 1, 1);
      expect(stderrSpy).toHaveBeenCalled();
    });
  });
});
