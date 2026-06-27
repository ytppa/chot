export type LinkifiedTextPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'link';
      text: string;
      href: string;
    };

const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/giu;
const TRAILING_PUNCTUATION_PATTERN = /[.,!?;:)\]}]+$/u;

/**
 * Splits plain text into safe text and link parts without producing HTML strings.
 */
export function linkifyText(text: string): LinkifiedTextPart[] {
  const parts: LinkifiedTextPart[] = [];
  let lastIndex = 0;

  URL_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const rawMatch = match[0];
    const matchIndex = match.index ?? 0;
    const candidate = splitTrailingPunctuation(rawMatch);
    const href = toSafeHref(candidate.linkText);

    if (!href) {
      continue;
    }

    // Preserve ordinary text before the URL as a text node.
    if (matchIndex > lastIndex) {
      parts.push({
        type: 'text',
        text: text.slice(lastIndex, matchIndex)
      });
    }

    parts.push({
      type: 'link',
      text: candidate.linkText,
      href
    });

    if (candidate.trailingText !== '') {
      parts.push({
        type: 'text',
        text: candidate.trailingText
      });
    }

    lastIndex = matchIndex + rawMatch.length;
  }

  // Keep the full original text when there were no safe links.
  if (lastIndex === 0) {
    return [
      {
        type: 'text',
        text
      }
    ];
  }

  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      text: text.slice(lastIndex)
    });
  }

  return parts;
}

/**
 * Removes punctuation that usually belongs to the sentence, not the URL.
 */
function splitTrailingPunctuation(rawUrl: string): { linkText: string; trailingText: string } {
  const trailingMatch = rawUrl.match(TRAILING_PUNCTUATION_PATTERN);
  if (!trailingMatch) {
    return {
      linkText: rawUrl,
      trailingText: ''
    };
  }

  const trailingText = trailingMatch[0];
  return {
    linkText: rawUrl.slice(0, -trailingText.length),
    trailingText
  };
}

/**
 * Normalizes supported URL shapes and rejects unsafe or malformed protocols.
 */
function toSafeHref(linkText: string): string | null {
  const normalized = linkText.startsWith('www.') ? `https://${linkText}` : linkText;

  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}
