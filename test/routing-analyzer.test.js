import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRoutingPrompt,
  normalizeSemanticSuggestions,
  safeSemanticSuggestions,
  SemanticRoutingAnalyzer,
} from '../src/routing-analyzer.js';

test('routing prompt redacts secrets and limits candidates to formal projects', () => {
  const prompt = buildRoutingPrompt({
    messages: [{ message_id: 'om_real_1', text: 'token=secret-value AIMI 接口完成了' }],
    projects: [{ name: 'AIMI智能体', aliases: ['AIMI'] }],
  });
  assert.doesNotMatch(prompt, /secret-value/);
  assert.match(prompt, /\[REDACTED:TOKEN\]/);
  assert.match(prompt, /AIMI智能体/);
  assert.match(prompt, /om_real_1/);
});

test('semantic suggestions always remain pending regardless of confidence', () => {
  const suggestions = normalizeSemanticSuggestions([
    { messageId: 'm1', projectName: 'AIMI智能体', confidence: 0.999, reason: '语义明确' },
  ], new Set(['AIMI智能体']));
  assert.equal(suggestions[0].status, '待确认');
  assert.equal(suggestions[0].basis, 'AI语义建议');
});

test('semantic suggestions with invented message ids are discarded', () => {
  const suggestions = normalizeSemanticSuggestions(
    [{ messageId: 'message_0', projectName: 'AIMI智能体', confidence: 0.9, reason: 'guess' }],
    new Set(['AIMI智能体']),
    new Set(['om_real_1']),
  );

  assert.deepEqual(suggestions, []);
});

test('semantic routing aborts a hung request at its configured timeout', async () => {
  const analyzer = new SemanticRoutingAnalyzer({
    apiKey: 'test-key',
    timeoutMs: 10,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }),
  });

  await assert.rejects(analyzer.analyze({ messages: [], projects: [] }), /timeout|aborted/i);
});

test('semantic routing failure degrades to pending deterministic review', async () => {
  const errors = [];
  const suggestions = await safeSemanticSuggestions(
    { analyze: async () => { throw new Error('network unavailable'); } },
    { messages: [], projects: [] },
    (error) => errors.push(error.message),
  );

  assert.deepEqual(suggestions, []);
  assert.deepEqual(errors, ['network unavailable']);
});
