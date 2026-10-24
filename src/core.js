export function id(value) {
  const result = String(value ?? '');
  return /^\d+$/.test(result) ? result : '';
}

export function messageId(value) {
  const result = String(value ?? '');
  return /^-?\d+$/.test(result) ? result : '';
}

export function conversationKey(event) {
  if (event?.message_type === 'private') {
    const user = id(event.user_id);
    return user ? `private:${user}` : '';
  }
  if (event?.message_type === 'group') {
    const group = id(event.group_id);
    return group ? `group:${group}` : '';
  }
  return '';
}

export function parseMessage(message, selfId) {
  let text = '';
  let mentioned = false;
  let replyId = '';
  if (Array.isArray(message)) {
    for (const segment of message) {
      const data = segment?.data ?? {};
      if (segment?.type === 'text') text += String(data.text ?? '');
      if (segment?.type === 'at' && id(data.qq) === selfId) mentioned = true;
      if (segment?.type === 'reply') replyId = messageId(data.id) || replyId;
    }
  } else if (typeof message === 'string') {
    mentioned = [...message.matchAll(/\[CQ:at,qq=(\d+)(?:,[^\]]*)?\]/g)].some((match) => match[1] === selfId);
    replyId = messageId(/\[CQ:reply,id=(-?\d+)(?:,[^\]]*)?\]/.exec(message)?.[1]);
    text = message.replace(/\[CQ:[^\]]*\]/g, '');
  }
  return { text: text.trim(), mentioned, replyId };
}

export async function classifyMessage(event, config, selfId, isReplyToSelf = async () => false) {
  if (event?.post_type !== 'message') return null;
  const sender = id(event.user_id);
  if (!sender || sender === selfId) return null;
  const key = conversationKey(event);
  if (!key) return null;
  const { text, mentioned, replyId } = parseMessage(event.message, selfId);
  if (!text) return null;
  if (event.message_type === 'private') {
    if (!config.allow.private.includes(sender)) return null;
    return { key, text, sender, target: sender, type: 'private' };
  }
  const group = id(event.group_id);
  if (!config.allow.groups.includes(group)) return null;
  if (!mentioned && !(replyId && await isReplyToSelf(replyId))) return null;
  return { key, text, sender, target: group, type: 'group' };
}

export function makeInput(classified) {
  return classified.type === 'group'
    ? `群成员 ${classified.sender}：${classified.text}`
    : classified.text;
}

export function responseText(value, maxChars) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('模型返回了空回复');
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
