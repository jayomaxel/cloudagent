import test from 'node:test';
import assert from 'node:assert/strict';

import { ProjectRouter } from '../src/router.js';

const router = new ProjectRouter({
  projects: [
    { recordId: 'rec_aimi', name: 'AIMI智能体', aliases: ['AIMI'] },
    { recordId: 'rec_wuzhou', name: '五洲项目', aliases: ['五洲'] },
    { recordId: 'rec_ops', name: '工作室运营 / 多项目混合', aliases: ['工作室运营'] },
  ],
  operationsProjectName: '工作室运营 / 多项目混合',
});

test('reply inherits the single confirmed project from its parent message', () => {
  const routes = router.routeRound({
    mapping: { chatType: '混合' },
    messages: [
      { message_id: 'om_parent', content: 'AIMI 本周完成接口联调' },
      { message_id: 'om_reply', reply_to: 'om_parent', content: '收到，我继续处理' },
    ],
  });

  const inherited = routes.find((route) => route.messageId === 'om_reply');
  assert.equal(inherited.projectName, 'AIMI智能体');
  assert.equal(inherited.basis, '回复继承');
  assert.equal(inherited.reviewStatus, '自动确认');
});

test('reply does not inherit an ambiguous multi-project parent', () => {
  const routes = router.routeRound({
    mapping: { chatType: '混合' },
    messages: [
      { message_id: 'om_parent', content: 'AIMI 和五洲一起同步' },
      { message_id: 'om_reply', reply_to: 'om_parent', content: '继续' },
    ],
  });

  const inherited = routes.find((route) => route.messageId === 'om_reply');
  assert.equal(inherited.projectName, '');
  assert.equal(inherited.reviewStatus, '待确认');
});
