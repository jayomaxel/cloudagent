import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateShadowAudit } from '../src/shadow-audit.js';
import { reviewStatusForMode } from '../src/router.js';

test('shadow deterministic routes require human confirmation', () => {
  assert.equal(reviewStatusForMode('自动确认', '影子'), '待确认');
  assert.equal(reviewStatusForMode('自动确认', '正式'), '自动确认');
  assert.equal(reviewStatusForMode('待确认', '正式'), '待确认');
});

test('shadow audit becomes ready after three days, thirty reviews and 95 percent precision', () => {
  const startedAt = '2026-08-01T00:00:00Z';
  const routes = Array.from({ length: 30 }, (_, index) => ({
    routeId: `route_${index}`,
    routeMode: '影子',
    basis: '确认别名',
    reviewStatus: index === 0 ? '已驳回' : '已确认',
    createdAt: startedAt,
  }));

  const audit = calculateShadowAudit(routes, {
    now: Date.parse('2026-08-04T01:00:00Z'),
    minimumDays: 3,
    minimumAuditedMessages: 30,
    minimumDeterministicPrecision: 0.95,
  });

  assert.equal(audit.reviewed, 30);
  assert.equal(audit.correct, 29);
  assert.equal(audit.precision, 29 / 30);
  assert.equal(audit.readyForManualPromotion, true);
});

test('AI suggestions and unresolved guesses do not inflate deterministic precision', () => {
  const audit = calculateShadowAudit([
    { routeId: 'r1', routeMode: '影子', basis: 'AI语义建议', reviewStatus: '已确认', createdAt: '2026-08-01T00:00:00Z' },
    { routeId: 'r2', routeMode: '影子', basis: 'AI判断', reviewStatus: '已确认', createdAt: '2026-08-01T00:00:00Z' },
    { routeId: 'r3', routeMode: '影子', basis: '汇报模板', reviewStatus: '待确认', createdAt: '2026-08-01T00:00:00Z' },
  ], { now: Date.parse('2026-08-08T00:00:00Z') });

  assert.equal(audit.eligible, 1);
  assert.equal(audit.reviewed, 0);
  assert.equal(audit.readyForManualPromotion, false);
});

