const MESSAGE_TYPE_LABELS = {
  image: "图片消息",
  file: "文件消息",
  audio: "语音消息",
  media: "视频消息",
  video: "视频消息",
  sticker: "表情消息",
  interactive: "卡片消息",
  share_chat: "群聊分享消息",
  share_user: "联系人分享消息",
  merge_forward: "合并转发消息",
  system: "系统消息",
};

const BASIS_LABELS = {
  "群绑定": "该消息来自项目专属群",
  "汇报模板": "消息使用了项目汇报模板",
  "确认别名": "消息包含已确认的项目名称或别名",
  "回复继承": "消息回复了已经完成项目归属的内容",
  "AI判断": "Agent 根据消息上下文给出建议",
};

function collectReadableText(value, depth = 0) {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => collectReadableText(item, depth + 1)).filter(Boolean).join(" ");
  if (typeof value !== "object") return "";

  const preferredKeys = ["title", "text", "content", "href", "url", "elements", "children"];
  const preferred = preferredKeys
    .filter((key) => key in value)
    .map((key) => collectReadableText(value[key], depth + 1))
    .filter(Boolean)
    .join(" ");
  if (preferred) return preferred;

  const ignoredKeys = new Set(["open_id", "user_id", "union_id", "file_key", "image_key", "tenant_key"]);
  return Object.entries(value)
    .filter(([key]) => !ignoredKeys.has(key))
    .map(([, item]) => collectReadableText(item, depth + 1))
    .filter(Boolean)
    .join(" ");
}

function parseMessageContent(content) {
  if (typeof content !== "string") return collectReadableText(content);
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed;
  try {
    return collectReadableText(JSON.parse(trimmed));
  } catch {
    return trimmed;
  }
}

function sanitizePreview(text) {
  return String(text || "")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[已脱敏密钥]")
    .replace(/((?:api[_\s-]?key|access[_\s-]?token|token|secret|password|密钥|密码)\s*[:=：]\s*)\S+/gi, "$1[已脱敏]")
    .replace(/\b1[3-9]\d{9}\b/g, "[手机号已脱敏]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[邮箱已脱敏]")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function messagePreview(message, limit = 120) {
  const content = sanitizePreview(parseMessageContent(message?.content ?? message?.text));
  if (content) return truncate(content, limit);
  const type = message?.msg_type || message?.message_type;
  return type ? `[${MESSAGE_TYPE_LABELS[type] || `${type} 消息`}]` : "原消息不可回读";
}

function senderName(message) {
  return String(
    message?.sender?.name
      || message?.sender_name
      || message?.senderName
      || "未识别成员"
  ).trim();
}

function suggestedOwnership(route) {
  if (route?.projectName) return route.projectName;
  if (route?.type === "organization" || route?.type === "组织管理" || route?.scopeType === "工作室运营") return "组织管理";
  return "待确认";
}

function judgmentExplanation(route) {
  const basis = BASIS_LABELS[route?.basis] || route?.basis || "暂无明确规则依据";
  const reason = String(route?.reason || "").trim();
  if (!reason || reason === route?.basis || basis.includes(reason)) return truncate(basis, 240);
  return truncate(`${basis}；${reason}`, 240);
}

function reviewPrompt(route) {
  const status = route?.reviewStatus || route?.status;
  const ownership = suggestedOwnership(route);
  if (status === "自动确认") return "建议自动确认，无需人工处理";
  if (ownership === "组织管理") return "请确认该消息是否属于组织管理事项";
  if (ownership !== "待确认") return `请确认是否属于「${ownership}」；如不属于，请修改关联项目后更新审核状态`;
  return "请根据原消息选择正确项目，或将其标记为组织管理事项";
}

export function buildMessageReviewFields({ message = {}, route = {}, chatName = "" } = {}) {
  const preview = messagePreview(message);
  const displayName = senderName(message);
  return {
    messageOverview: truncate([displayName, chatName, preview].filter(Boolean).join("｜"), 180),
    messagePreview: preview,
    senderName: displayName,
    suggestedOwnership: suggestedOwnership(route),
    judgmentExplanation: judgmentExplanation(route),
    reviewPrompt: reviewPrompt(route),
  };
}
