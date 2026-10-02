import { Header } from './components/Header';
import { EmptyState } from './components/ui';
import { CreatePage } from './pages/CreatePage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { href, useRoute } from './router';

export function App() {
  const route = useRoute();
  return (
    <div className="shell">
      <Header route={route} />
      <main>
        {route.name === 'create' ? <CreatePage /> : null}
        {route.name === 'history' ? <HistoryPage /> : null}
        {route.name === 'dashboard' ? <DashboardPage key={route.id} id={route.id} /> : null}
        {route.name === 'notFound' ? (
          <div className="card">
            <EmptyState
              title="ไม่พบหน้านี้"
              action={
                <a className="btn" href={href.create()}>
                  กลับหน้าแรก
                </a>
              }
            />
          </div>
        ) : null}
      </main>
      <footer className="footer">
        Pulse Link · ไม่มีระบบสมาชิก ลิงก์ของคุณผูกกับเบราว์เซอร์นี้
      </footer>
    </div>
  );
}
