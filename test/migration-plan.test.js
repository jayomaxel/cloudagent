import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_SCHEMA,
  FIELD_ADDITIONS,
  computeMigrationPlan,
} from '../src/migration-plan.js';

test('migration schema includes P0 indexes and P1 route review tables', () => {
  assert.ok(AGENT_SCHEMA['Agent 消息处理索引'].some((field) => field.name === '消息ID'));
  assert.ok(AGENT_SCHEMA['Agent 分析批次'].some((field) => field.name === '重试次数'));
  assert.ok(AGENT_SCHEMA['Agent 消息项目归属'].some((field) => field.name === '审核负责人'));
  assert.ok(FIELD_ADDITIONS['项目库'].some((field) => field.name === '项目别名'));
  assert.ok(FIELD_ADDITIONS['Agent 群聊配置'].some((field) => field.name === '路由模式'));
});

test('migration planner is additive and idempotent', () => {
  const empty = computeMigrationPlan({ tables: {} });
  assert.equal(empty.createTables.length, Object.keys(AGENT_SCHEMA).length);
  assert.ok(empty.addFields.length > 0);
  assert.equal(empty.destructiveChanges.length, 0);

  const completeTables = {};
  for (const [name, fields] of Object.entries(AGENT_SCHEMA)) {
    completeTables[name] = fields.map((field) => field.name);
  }
  for (const [name, fields] of Object.entries(FIELD_ADDITIONS)) {
    completeTables[name] = fields.map((field) => field.name);
  }
  const complete = computeMigrationPlan({ tables: completeTables });
  assert.deepEqual(complete.createTables, []);
  assert.deepEqual(complete.addFields, []);
  assert.equal(complete.destructiveChanges.length, 0);
});
