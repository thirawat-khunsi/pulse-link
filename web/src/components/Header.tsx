import { href, type Route } from '../router';

// One heartbeat repeated across a wide viewBox; scaled to the header width.
const ECG =
  'M0 18 H140 l8 -2 6 2 H190 l6 -14 8 22 6 -12 5 4 H420 l8 -2 6 2 H470 l6 -14 8 22 6 -12 5 4 H700 ' +
  'l8 -2 6 2 H750 l6 -14 8 22 6 -12 5 4 H1000';

export function Header({ route }: { route: Route }) {
  const current = (name: Route['name']) => (route.name === name ? 'page' : undefined);
  return (
    <header className="header">
      <a className="brand" href={href.create()}>
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="9" fill="#18213d" />
          <path
            d="M3 17h7l3-8 5 15 3-7h8"
            fill="none"
            stroke="#3df5a7"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>
          Pulse Link
          <small>ลิงก์สั้นที่ดูชีพจรได้แบบเรียลไทม์</small>
        </span>
      </a>
      <nav className="nav" aria-label="เมนูหลัก">
        <a href={href.create()} aria-current={current('create')}>
          สร้างลิงก์
        </a>
        <a href={href.history()} aria-current={current('history')}>
          ประวัติ
        </a>
      </nav>
      <svg className="ecg" viewBox="0 0 1000 26" preserveAspectRatio="none" aria-hidden="true">
        <path className="ecg-base" d="M0 18 H1000" />
        <path d={ECG} />
      </svg>
    </header>
  );
}
