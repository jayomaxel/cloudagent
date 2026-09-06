import test from 'node:test';
import assert from 'node:assert/strict';

import { cliJsonArgs } from '../src/lark.js';

test('auth status does not receive unsupported format flags', () => {
  assert.deepEqual(cliJsonArgs(['auth', 'status'], { supportsFormat: false }), ['auth', 'status']);
});

test('base commands still request JSON output', () => {
  assert.deepEqual(cliJsonArgs(['base', '+table-list']), ['base', '+table-list', '--format', 'json']);
});

