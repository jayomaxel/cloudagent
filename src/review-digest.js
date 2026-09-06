const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function parseReviewerIds(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))].sort();
}

export function shouldSendDigest(lastSentAt, now = Date.now()) {
  if (!lastSentAt) return true;
  const previous = Date.parse(lastSentAt);
  return !Number.isFinite(previous) || now - previous >= TWO_HOURS_MS;
}

export function buildReviewerDigests(routes, reviewerOpenIds, reviewUrl) {
  return parseReviewerIds(reviewerOpenIds).flatMap((openId) => {
    const pending = routes.filter((route) => {
      if (route.status !== '待确认') return false;
      return !parseReviewerIds(route.notifiedReviewerIds).includes(openId);
    });
    if (!pending.length) return [];
    const projectCounts = new Map();
    for (const route of pending) {
      const name = route.projectName || '未确定项目';
      projectCounts.set(name, (projectCounts.get(name) || 0) + 1);
    }
    const breakdown = [...projectCounts.entries()]
      .map(([name, count]) => `${name} ${count} 条`)
      .join('；');
    return [{
      openId,
      routeIds: pending.map((route) => route.routeId),
      text: [
        `云门 Agent 有 ${pending.length} 条新的项目归属待确认。`,
        breakdown,
        reviewUrl ? `审核入口：${reviewUrl}` : '',
        '本消息为两小时汇总，仅私聊负责人；已处理内容不会重复提醒。',
      ].filter(Boolean).join('\n'),
    }];
  });
}

