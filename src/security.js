const REDACTION_RULES = [
  {
    type: "database_url",
    pattern: /\b((?:DATABASE_URL|DB_URL|MONGODB_URI|REDIS_URL)\s*[:=]\s*)["']?[^\s"']+["']?/gi,
    replacement: "$1[已隐藏敏感信息:database_url]"
  },
  {
    type: "database_url",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi,
    replacement: "[已隐藏敏感信息:database_url]"
  },
  {
    type: "authorization",
    pattern: /\b(Authorization\s*:\s*Bearer\s+|Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi,
    replacement: "$1[已隐藏敏感信息:authorization]"
  },
  {
    type: "authorization",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    replacement: "[已隐藏敏感信息:authorization]"
  },
  {
    type: "api_key",
    pattern: /\b((?:OPENAI|DEEPSEEK|ANTHROPIC|GEMINI|LARK|FEISHU)?_?API_KEY\s*[:=]\s*)["']?[^\s"']+["']?/gi,
    replacement: "$1[已隐藏敏感信息:api_key]"
  },
  {
    type: "api_key",
    pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g,
    replacement: "[已隐藏敏感信息:api_key]"
  },
  {
    type: "password",
    pattern: /\b((?:PASSWORD|PASSWD|PWD|CLIENT_SECRET|APP_SECRET)\s*[:=]\s*)["']?[^\s"']+["']?/gi,
    replacement: "$1[已隐藏敏感信息:password]"
  },
  {
    type: "authorization",
    pattern: /\b((?:ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN|COOKIE)\s*[:=]\s*)["']?[^\s"']+["']?/gi,
    replacement: "$1[已隐藏敏感信息:authorization]"
  },
  {
    type: "verification_code",
    pattern: /((?:验证码|校验码|verification\s*code|verify\s*code|otp)\s*[:：]?\s*)\d{4,8}\b/gi,
    replacement: "$1[已隐藏敏感信息:verification_code]"
  }
];

export function redactText(value) {
  let text = String(value ?? "");
  const detections = [];
  for (const rule of REDACTION_RULES) {
    let matched = false;
    text = text.replace(rule.pattern, (...args) => {
      matched = true;
      if (rule.replacement.includes("$1")) {
        return rule.replacement.replace("$1", args[1] || "");
      }
      return rule.replacement;
    });
    if (matched) detections.push(rule.type);
  }
  return { text, detections: [...new Set(detections)] };
}

export function sanitizeMessages(messages) {
  const detections = new Set();
  const sanitized = (messages || []).map((message) => {
    const result = redactText(message.content);
    for (const type of result.detections) detections.add(type);
    return { ...message, content: result.text };
  });
  return { messages: sanitized, detections: [...detections] };
}

