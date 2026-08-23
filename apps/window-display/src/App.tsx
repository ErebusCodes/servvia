import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TableSelectionPage } from './pages/TableSelectionPage';
import { KioskWindowSignagePage } from './pages/KioskWindowSignagePage';
import { KioskOrderPage } from './pages/KioskOrderPage';
import { KdsPage } from './pages/KdsPage';
import { KdsPinGate } from './components/KdsPinGate';
import { useKioskStore } from './store/kiosk.store';

// @ts-ignore - JSX pages imported from customer-frontend
import Menu from '@/pages/Menu';
// @ts-ignore
import BookTable from '@/pages/BookTable';
// @ts-ignore
import About from '@/pages/About';
// @ts-ignore
import Contact from '@/pages/Contact';

export function App() {
  const { selectedTable, orderType, clearSelection } = useKioskStore();
  const defaultPage = import.meta.env.VITE_APP_MODE === 'kds'
    ? <KdsPinGate><KdsPage /></KdsPinGate>
    : <KioskWindowSignagePage />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={defaultPage} />
        <Route path="/tables" element={<TableSelectionPage />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/book" element={<BookTable />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route
          path="/order"
          element={
            selectedTable || orderType === 'Takeaway' ? (
              <KioskOrderPage onBackToTables={clearSelection} />
            ) : (
              <Navigate to="/tables" replace />
            )
          }
        />
        <Route path="/kds" element={<KdsPinGate><KdsPage /></KdsPinGate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
