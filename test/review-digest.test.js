import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReviewerDigests,
  parseReviewerIds,
  shouldSendDigest,
} from '../src/review-digest.js';

test('review digests are private, batched, and only include unnotified routes', () => {
  const routes = [
    { routeId: 'route_1', projectName: 'AIMI智能体', status: '待确认', notifiedReviewerIds: '' },
    { routeId: 'route_2', projectName: '五洲项目', status: '待确认', notifiedReviewerIds: 'ou_a' },
    { routeId: 'route_3', projectName: '五洲项目', status: '已确认', notifiedReviewerIds: '' },
  ];
  const digests = buildReviewerDigests(routes, ['ou_a', 'ou_b'], 'https://example.feishu.cn/base/x');

  assert.deepEqual(digests.map((item) => item.openId), ['ou_a', 'ou_b']);
  assert.equal(digests[0].routeIds.join(','), 'route_1');
  assert.equal(digests[1].routeIds.join(','), 'route_1,route_2');
  assert.match(digests[1].text, /2 条/);
  assert.doesNotMatch(digests[1].text, /群内/);
});

test('reviewer id serialization is stable and de-duplicated', () => {
  assert.deepEqual(parseReviewerIds('ou_b, ou_a,ou_b'), ['ou_a', 'ou_b']);
});

test('digest cadence is two hours unless new reviewer has never been notified', () => {
  const now = Date.parse('2026-08-06T12:00:00Z');
  assert.equal(shouldSendDigest(null, now), true);
  assert.equal(shouldSendDigest('2026-08-06T11:00:01Z', now), false);
  assert.equal(shouldSendDigest('2026-08-06T09:59:59Z', now), true);
});
