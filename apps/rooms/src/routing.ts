export function recipients(
  text: string,
  agents: { id: string; handle: string }[],
  fallback: string | null,
): string[] {
  const mentions = [
    ...text.matchAll(/(?:^|[^\w@])@([a-z][a-z0-9_-]*)(?![\w.-])/gi),
  ].map((m) => m[1].toLowerCase());
  if (mentions.length)
    return agents.filter((a) => mentions.includes(a.handle)).map((a) => a.id);
  return /@/.test(text) ? [] : fallback ? [fallback] : [];
}
