/**
 * Automated clients whose visits are recorded with is_bot=true and never consume max_clicks
 * (DECISIONS D-001, D-019): chat link previews, search engine crawlers and headless browsers.
 * Command-line tools and HTTP libraries (curl, wget, python-requests, ...) count as people.
 */
const BOT_PATTERN = new RegExp(
  [
    // Chat and social link previews. LINE fetches previews as "facebookexternalhit/1.1;line-poker/1.0";
    // its in-app browser ("... Line/13.20.0") is a real person and must not match.
    'facebookexternalhit',
    'facebookcatalog',
    'meta-externalagent',
    'line-poker',
    'linebot',
    'slackbot',
    'slack-imgproxy',
    'whatsapp',
    'telegrambot',
    'discordbot',
    'twitterbot',
    'linkedinbot',
    'skypeuripreview',
    // Search engines and generic crawlers.
    'googlebot',
    'google-inspectiontool',
    'bingbot',
    'yandex(?:bot|images)',
    'baiduspider',
    'duckduckbot',
    'applebot',
    'petalbot',
    'crawler',
    'spider',
    '[a-z]bot\\b',
    // Headless browsers.
    'headlesschrome',
  ].join('|'),
  'i',
);

// Phone brand that would otherwise match "[a-z]bot\b".
const NOT_BOT = /\bcubot\b/i;

export function isBot(userAgent: string | undefined): boolean {
  const ua = userAgent?.trim() ?? '';
  // Every real browser sends a User-Agent; an empty one is a script that chose to hide.
  if (ua === '') return true;
  return BOT_PATTERN.test(ua) && !NOT_BOT.test(ua);
}
