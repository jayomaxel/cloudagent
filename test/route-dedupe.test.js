import test from 'node:test';
import assert from 'node:assert/strict';

import { duplicateUnresolvedRouteIds, invalidSemanticRouteIds } from '../src/router.js';

test('semantic no-project duplicate is rejected while the base pending route remains', () => {
  const duplicates = duplicateUnresolvedRouteIds([
    { routeId: 'base_1', messageId: 'om_1', projectName: '', basis: 'AI判断', reviewStatus: '待确认' },
    { routeId: 'semantic_1', messageId: 'om_1', projectName: '', basis: 'AI语义建议：无法判断', reviewStatus: '待确认' },
    { routeId: 'project_1', messageId: 'om_2', projectName: 'AIMI智能体', basis: 'AI语义建议', reviewStatus: '待确认' },
  ]);

  assert.deepEqual(duplicates, ['semantic_1']);
});

test('semantic routes pointing to invented message ids are invalid', () => {
  const invalid = invalidSemanticRouteIds([
    { routeId: 'route_valid', messageId: 'om_1', basis: 'AI语义建议' },
    { routeId: 'route_fake', messageId: 'message_0', basis: 'AI语义建议' },
    { routeId: 'route_base', messageId: 'om_missing', basis: 'AI判断' },
  ], new Set(['om_1']));

  assert.deepEqual(invalid, ['route_fake']);
});
