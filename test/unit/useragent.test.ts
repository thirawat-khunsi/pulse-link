import { describe, expect, it } from 'vitest';
import { parseUserAgent, referrerHost } from '../../src/modules/clicks/useragent.js';
import { isBot } from '../../src/shared/bot.js';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  lineInApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.20.0',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  cubot:
    'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
};

describe('isBot (DECISIONS D-019)', () => {
  it.each([
    ['LINE preview', 'facebookexternalhit/1.1;line-poker/1.0'],
    [
      'Facebook preview',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    ],
    ['Slack preview', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['WhatsApp preview', 'WhatsApp/2.23.20.0 A'],
    ['Telegram preview', 'TelegramBot (like TwitterBot)'],
    ['Discord preview', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['Bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
    [
      'Baidu',
      'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
    ],
    [
      'HeadlessChrome',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/125.0.0.0 Safari/537.36',
    ],
    ['empty', ''],
    ['missing', undefined],
  ])('%s → bot', (_name, ua) => {
    expect(isBot(ua)).toBe(true);
  });

  it.each([
    ['iPhone Safari', UA.iphone],
    ['LINE in-app browser', UA.lineInApp],
    ['Android Chrome', UA.android],
    ['Windows Chrome', UA.windows],
    ['CUBOT phone', UA.cubot],
    ['curl', 'curl/8.4.0'],
    ['wget', 'Wget/1.21.4'],
    ['python-requests', 'python-requests/2.31.0'],
    ['Go', 'Go-http-client/1.1'],
    ['node fetch', 'node'],
  ])('%s → person', (_name, ua) => {
    expect(isBot(ua)).toBe(false);
  });
});

describe('parseUserAgent', () => {
  it.each([
    ['iPhone', UA.iphone, { device: 'mobile', browser: 'Mobile Safari', os: 'iOS' }],
    ['LINE in-app', UA.lineInApp, { device: 'mobile', browser: 'LINE', os: 'iOS' }],
    ['Android', UA.android, { device: 'mobile', browser: 'Chrome', os: 'Android' }],
    ['iPad', UA.ipad, { device: 'tablet', browser: 'Mobile Safari', os: 'iOS' }],
    ['Windows', UA.windows, { device: 'desktop', browser: 'Chrome', os: 'Windows' }],
    ['curl', 'curl/8.4.0', { device: 'unknown', browser: 'curl', os: null }],
    ['empty', '', { device: 'unknown', browser: null, os: null }],
  ] as const)('%s', (_name, ua, expected) => {
    expect(parseUserAgent(ua, false)).toEqual(expected);
  });

  it('marks bots as device=bot but keeps browser/os', () => {
    expect(parseUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)', true).device).toBe('bot');
  });

  it('truncates to the column widths', () => {
    const parsed = parseUserAgent(`${'x'.repeat(100)}/1.0`, false);
    expect(parsed.browser).toHaveLength(64);
  });
});

describe('referrerHost', () => {
  it.each([
    ['https://www.Facebook.com/some/path?q=secret', 'www.facebook.com'],
    ['http://line.me/', 'line.me'],
    ['android-app://com.google.android.gm/', null],
    ['not a url', null],
    ['', null],
    [undefined, null],
  ])('%s → %s', (referer, expected) => {
    expect(referrerHost(referer)).toBe(expected);
  });
});
