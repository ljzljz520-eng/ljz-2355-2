import type { A11yViolation } from '../types.js';

/**
 * Dependency-free accessibility checks run against rendered HTML.
 * Mirrors what the in-browser preview bootstrap checks so server gate and
 * client rendering cannot disagree.
 */
export function runA11yChecks(html: string): A11yViolation[] {
  const violations: A11yViolation[] = [];
  const v = (rule: string, message: string, fragment?: string): void => {
    violations.push({ rule, message, html: fragment });
  };

  // 1. Interactive elements must have an accessible name. Text hidden from
  // assistive tech (aria-hidden) does not count as an accessible name.
  const buttonRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let m: RegExpExecArray | null;
  while ((m = buttonRe.exec(html))) {
    const attrs = m[1];
    const inner = m[2];
    const named =
      /\baria-label\s*=\s*["'][^"']+["']/i.test(attrs) ||
      /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(attrs) ||
      /\btitle\s*=\s*["'][^"']+["']/i.test(attrs) ||
      accessibleText(inner).trim().length > 0 ||
      /<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(inner);
    if (!named) v('button-name', '<button> has no accessible name', m[0]);
  }

  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  while ((m = linkRe.exec(html))) {
    const named =
      /\baria-label\s*=\s*["'][^"']+["']/i.test(m[1]) ||
      /\btitle\s*=\s*["'][^"']+["']/i.test(m[1]) ||
      accessibleText(m[2]).trim().length > 0 ||
      /<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(m[2]);
    if (!named) v('link-name', '<a> has no accessible name', m[0]);
  }

  // 2. Images need alt text (empty alt is allowed for decorative images).
  const imgRe = /<img\b[^>]*>/gi;
  while ((m = imgRe.exec(html))) {
    if (!/\balt\s*=/i.test(m[0])) {
      v('img-alt', '<img> is missing alt attribute', m[0]);
    }
  }

  // 3. Form controls need an associated label.
  const inputRe = /<(input|select|textarea)\b([^>]*)>/gi;
  while ((m = inputRe.exec(html))) {
    if (/\btype\s*=\s*["']?(hidden|submit|button|reset)["']?/i.test(m[2]))
      continue;
    const named =
      /\baria-label\s*=\s*["'][^"']+["']/i.test(m[2]) ||
      /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(m[2]) ||
      /\btitle\s*=\s*["'][^"']+["']/i.test(m[2]) ||
      /\bid\s*=\s*["']([^"']+)["']/i.test(m[2]) &&
        new RegExp(`<label[^>]+for=["']${idOf(m[2])}["']`, 'i').test(html);
    if (!named)
      v('label', 'form control has no accessible label', m[0]);
  }

  // 4. Ids must be unique.
  const ids = new Set<string>();
  const idRe = /\bid\s*=\s*["']([^"']+)["']/gi;
  while ((m = idRe.exec(html))) {
    if (ids.has(m[1])) v('duplicate-id', `duplicate id "${m[1]}"`, m[0]);
    ids.add(m[1]);
  }

  // 5. html/body must declare a language.
  if (/<html\b/i.test(html) && !/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html)) {
    v('html-has-lang', '<html> element must have a lang attribute');
  }

  // 6. color-contrast stand-in: no inline color matching its background hint.
  if (/\bstyle\s*=\s*["'][^"']*color\s*:\s*(#fff|white|transparent)/i.test(html) &&
      /background(-color)?\s*:\s*(#fff|white)/i.test(html)) {
    v('color-contrast', 'possible low-contrast inline style');
  }

  return violations;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/** Text content excluding elements hidden from assistive technology. */
function accessibleText(s: string): string {
  return stripTags(
    s.replace(
      /<[^>]*\baria-hidden\s*=\s*["']?(true|["'])["']?[^>]*>[\s\S]*?<\/[^>]+>/gi,
      '',
    ),
  );
}

function idOf(attrs: string): string {
  const m = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
  return m ? m[1] : '';
}
