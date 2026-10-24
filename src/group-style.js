const choices = {
  tone: ['轻松', '认真', '温柔', '直接', '活泼'],
  length: ['短句', '中等', '较长'],
  emoji: ['少', '适中', '多'],
  humor: ['少', '适中', '多']
};

export function normalizeGroupStyle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const style = {};
  for (const [field, allowed] of Object.entries(choices)) {
    if (!allowed.includes(value[field])) return null;
    style[field] = value[field];
  }
  style.phrases = Array.isArray(value.phrases)
    ? value.phrases.filter((phrase) => typeof phrase === 'string' && /^[\p{L}\p{N}\p{P}\p{S}]{1,8}$/u.test(phrase)).slice(0, 3)
    : [];
  return style;
}

export function groupStyleGuide(style) {
  const value = normalizeGroupStyle(style);
  if (!value) return '';
  const phrases = value.phrases.length ? `常见短表达：${value.phrases.join('、')}。仅在自然贴切时使用，不要机械复读。` : '';
  return `这个群近期的表达习惯：语气${value.tone}，句子${value.length}，表情使用${value.emoji}，玩笑${value.humor}。${phrases}`;
}

export function canLearnGroupStyle(context) {
  const textMessages = context.filter((message) => typeof message.text === 'string' && message.text.trim() && !message.direct);
  return textMessages.length >= 6 && new Set(textMessages.map((message) => message.sender)).size >= 2;
}
