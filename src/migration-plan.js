const text = (name) => ({ name, type: 'text' });
const number = (name) => ({ name, type: 'number' });
const date = (name) => ({ name, type: 'date' });
const checkbox = (name) => ({ name, type: 'checkbox' });
const select = (name, options) => ({ name, type: 'select', options });
const user = (name, multiple = false) => ({ name, type: 'user', multiple });
const link = (name, tableName, multiple = true) => ({ name, type: 'link', tableName, multiple });

export const AGENT_SCHEMA = Object.freeze({
  'Agent 消息处理索引': [
    text('消息ID'), text('群聊ID'), text('群聊名称'), user('发送成员'), date('消息时间'),
    text('回复消息ID'), text('内容指纹'), number('内容字符数'), text('敏感信息类型'),
    text('批次ID'), select('处理状态', ['待处理', '处理中', '成功', '待重试', '永久失败']),
    text('处理阶段'), text('错误信息'), number('重试次数'), date('首次处理'), date('最后处理'),
    text('Agent版本'),
  ],
  'Agent 分析批次': [
    text('批次ID'), select('来源', ['实时消息', '历史补读', '失败恢复']), text('群聊ID'), text('群聊名称'),
    date('开始时间'), date('结束时间'), number('消息数量'), text('消息ID'),
    select('处理状态', ['待处理', '处理中', '成功', '待重试', '永久失败']), text('处理阶段'),
    number('重试次数'), date('下次重试'), text('模型'), text('错误信息'), text('敏感信息类型'),
    text('Agent版本'), date('创建时间'), date('完成时间'),
  ],
  'Agent 消息项目归属': [
    text('消息概览'), text('内部路由ID'), text('消息ID'), text('批次ID'), text('群聊ID'), text('群聊名称'), date('消息时间'), text('消息链接'),
    text('消息内容预览'), user('发送成员'), text('发送人姓名'), select('归属类型', ['项目', '组织管理', '无法判断']), link('关联项目', '项目库'),
    text('正式项目名称'), text('Agent建议归属'), text('归属依据'), text('判断说明'), number('置信度'), select('路由模式', ['影子', '正式']),
    select('审核状态', ['自动确认', '待确认', '已确认', '已驳回']), text('候选别名'),
    select('候选别名状态', ['无', '待确认', '已采纳', '已同步', '已驳回']), user('审核负责人', true),
    text('审核提示'), select('通知状态', ['未通知', '部分通知', '已通知']), text('已通知负责人ID'), date('最近通知时间'),
    text('Agent版本'), date('创建时间'),
  ],
  'Agent 运行状态': [
    text('实例ID'), select('运行状态', ['启动中', '运行中', '降级运行', '离线', '已停止']), text('Agent版本'), text('运行位置'),
    number('进程PID'), date('启动时间'), date('最近心跳'), date('最近收到消息'), date('最近完成分析'), number('运行时长秒'),
    number('监听群数量'), number('成员数量'), number('项目关系数量'), number('待分析会话数'), number('待重试批次数'), number('永久失败数'),
    select('飞书权限状态', ['正常', '异常', '未知']), select('模型连接状态', ['正常', '异常', '未知']),
    number('本次运行模型调用'), number('本次运行Token'), number('本次运行预计费用'), text('费用币种'),
    date('最近周报时间'), date('最近月报时间'), number('影子样本数'), number('影子已审核数'), number('影子精确率'), select('影子验收状态', ['观察中', '可人工晋级']),
    text('最后错误'), date('最后错误时间'), select('告警状态', ['正常', '已告警']), date('告警时间'), date('恢复时间'), text('备注'),
  ],
  'Agent 群监听状态': [
    text('群聊ID'), text('群聊名称'), text('所属项目'), checkbox('启用监听'), select('监听状态', ['正常', '降级', '异常', '排除']),
    date('最近收到消息'), date('最近完成分析'), date('最近成员同步'), number('待分析消息数'), number('连续失败次数'),
    text('最后错误'), date('最后错误时间'), select('告警状态', ['正常', '已告警']), date('最近心跳'), text('Agent版本'),
  ],
  'Agent 运行事件': [
    text('事件ID'), select('事件类型', ['模型调用', '分析失败', '批次永久失败', '飞书权限异常', '群监听异常', '恢复']),
    select('严重级别', ['信息', '警告', '高']), select('执行状态', ['成功', '失败']), text('实例ID'), text('用途'), text('提供方'), text('模型'),
    text('所属项目'), text('群聊ID'), text('批次ID'), date('开始时间'), date('结束时间'), number('耗时毫秒'),
    number('输入Token'), number('缓存输入Token'), number('输出Token'), number('总Token'), number('预计费用'), text('费用币种'),
    text('错误类型'), text('错误信息'), text('Agent版本'), date('创建时间'),
  ],
  'Agent 结论证据链': [
    text('结论ID'), select('结论层级', ['事实', '推断', '评价']), select('结论类型', ['贡献', '行动项', '决策', '话题快照', '工作风格评价']),
    text('结论正文'), text('证据说明'), link('关联项目', '项目库', false), text('所属项目'), user('观察成员', true), text('观察成员OpenID'),
    text('来源群ID'), text('来源群名称'), text('批次ID'), text('来源消息ID'), text('原始消息链接'), number('证据数量'), number('批次数量'),
    date('证据开始时间'), date('证据结束时间'), number('置信度'), select('敏感等级', ['低', '中', '高']), checkbox('是否需要人工审核'),
    select('审核状态', ['自动确认', '待审核', '已确认', '已修正', '已驳回']), user('审核人'), date('审核时间'), text('修正结论'),
    text('成员反馈'), date('反馈时间'), link('关联成员档案', '成员档案', false), text('Agent版本'), date('生成时间'),
  ],
});

export const FIELD_ADDITIONS = Object.freeze({
  '项目库': [text('项目别名')],
  'Agent 群聊配置': [
    select('群聊类型', ['排除', '项目专属', '混合', '组织管理']), checkbox('允许多项目归属'),
    select('路由模式', ['关闭', '影子', '正式']), checkbox('分析组织管理'),
  ],
  'Agent 贡献证据': [text('事实ID'), text('结论ID'), select('结论层级', ['事实', '推断']), text('证据说明'), text('原始消息链接'), number('证据数量'), date('证据开始时间'), date('证据结束时间')],
  'Agent 行动项': [text('行动ID'), text('结论ID'), select('结论层级', ['事实', '推断']), text('证据说明'), text('原始消息链接'), number('证据数量'), date('证据开始时间'), date('证据结束时间'), checkbox('是否需要人工审核')],
  'Agent 决策记录': [text('决策ID'), text('结论ID'), select('结论层级', ['事实', '推断']), text('证据说明'), text('原始消息链接'), number('证据数量'), date('证据开始时间'), date('证据结束时间'), checkbox('是否需要人工审核')],
  'Agent 文档审核': [text('草稿ID')],
  'Agent 群聊话题快照': [text('结论ID'), select('结论层级', ['事实', '推断']), text('证据说明'), text('原始消息链接')],
});

export const DEFAULT_PROJECT_ALIASES = Object.freeze({
  '云门工作室管理 Agent': ['飞书云agent', '云agent', 'CloudAgent', '工作室管理Agent'],
  'AIMI智能体': ['AIMI', 'AIMI智能体设计'],
  '五洲项目': ['五洲', '五州'],
  '工作室运营 / 多项目混合': ['开发组', '工作室运营', '团队管理', '多项目混合'],
});

export function computeMigrationPlan(snapshot = { tables: {} }) {
  const tables = snapshot.tables || {};
  const createTables = [];
  const addFields = [];
  for (const [tableName, fields] of Object.entries(AGENT_SCHEMA)) {
    if (!tables[tableName]) {
      createTables.push({ tableName, fields });
      continue;
    }
    const existing = new Set(tables[tableName]);
    for (const field of fields) {
      if (!existing.has(field.name)) addFields.push({ tableName, field });
    }
  }
  for (const [tableName, fields] of Object.entries(FIELD_ADDITIONS)) {
    const existing = new Set(tables[tableName] || []);
    for (const field of fields) {
      if (!existing.has(field.name)) addFields.push({ tableName, field });
    }
  }
  return { createTables, addFields, destructiveChanges: [] };
}
