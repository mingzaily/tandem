/** Explicit local links keep their task directory; network and custom schemes stay separate. */
export function localFileTarget(href: string): string | null {
  let path = href;
  if (href.startsWith('file:')) {
    try {
      const url = new URL(href);
      if (url.hostname && url.hostname !== 'localhost') return null;
      path = url.pathname;
    } catch { return null; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^[^:]+\.[\w.-]+:\d+(?::\d+)?$/.test(href)) return null;
  if (!path || path.startsWith('#') || path.startsWith('//')) return null;
  try { path = decodeURIComponent(path); } catch { return null; }
  return path.replace(/#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/, '').replace(/:\d+(?::\d+)?$/, '');
}

/** Matches Cindy's shouldRenderCodeReferenceLabel: exact target forms, then file-shaped labels. */
export function shouldRenderFileChip(path: string, label: string): boolean {
  const text = label.trim();
  if (!text || text.includes('\n')) return false;
  const name = path.split('/').pop() ?? path;
  if (text === path || text === name || new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+(?::\\d+)?$`).test(text)) return true;
  const withoutLine = text.replace(/:\d+(?::\d+)?$/, '');
  return /^(?:\.?\.?\/|~\/|\/)/.test(withoutLine) || (!/\s/.test(withoutLine) && (withoutLine.includes('/') || /(?:^|\/)[^/]+\.[\w.-]+$/.test(withoutLine)));
}
