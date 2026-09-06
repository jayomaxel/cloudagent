import test from 'node:test';
import assert from 'node:assert/strict';

import { buildModelClientOptions } from '../src/analyzer.js';

test('main analysis client disables hidden retries and enforces a request timeout', () => {
  const options = buildModelClientOptions({
    aiApiKey: 'test-key',
    aiBaseUrl: 'https://api.example.test',
    reliability: { modelTimeoutSeconds: 45 },
  });

  assert.equal(options.timeout, 45_000);
  assert.equal(options.maxRetries, 0);
  assert.equal(options.apiKey, 'test-key');
  assert.equal(options.baseURL, 'https://api.example.test');
});

