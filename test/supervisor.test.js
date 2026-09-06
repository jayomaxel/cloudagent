import test from 'node:test';
import assert from 'node:assert/strict';

import { restartDelayMs } from '../src/supervisor.js';

test('supervisor uses bounded restart backoff', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 10].map(restartDelayMs), [1_000, 5_000, 15_000, 60_000, 60_000, 60_000]);
});

