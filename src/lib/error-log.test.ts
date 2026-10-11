import { expect, test } from 'vitest';
import { clean, formatReport } from './error-log';

test('reports never carry API keys or URL queries', () => {
  const key = 'AIzaSyD4fake0key0value0for0testing123';
  expect(clean(`Failed to fetch https://generativelanguage.googleapis.com/v1/models?key=${key}`))
    .toBe('Failed to fetch https://generativelanguage.googleapis.com/v1/models');
  expect(clean(`Bearer ${key}`)).toBe('Bearer […]');
  expect(clean('word '.repeat(100))).toHaveLength(200);
});

test('the report lists the tool and the latest errors', () => {
  const report = formatReport([{ at: 0, where: 'page', message: 'TypeError: boom' }], { tool: 'IG Sorter', version: '0.2.0' });
  expect(report).toBe('tool: IG Sorter\nversion: 0.2.0\n\nRecent errors:\n1970-01-01T00:00:00.000Z [page] TypeError: boom');
  expect(formatReport([], {})).toContain('No errors recorded.');
});
