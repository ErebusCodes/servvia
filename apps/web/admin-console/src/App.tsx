import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useBootstrapAuth } from './hooks/useBootstrapAuth';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { KdsPinGate } from './components/kds/KdsPinGate';
import { TabletDeviceGate } from './components/tablet/TabletDeviceGate';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { AdminLayout } from './components/layout/AdminLayout';
import { VenueSettingsPage } from './pages/Venue/VenueSettingsPage';
import { TableManagementPage } from './pages/settings/TableManagementPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { MenuManagementPage } from './pages/menu/MenuManagementPage';
import { PosCatalogReviewPage } from './pages/menu/PosCatalogReviewPage';
import { ReservationsPage } from './pages/reservations/ReservationsPage';
import { KitchenDisplayPage } from './pages/kitchen/KitchenDisplayPage';
import { KioskWindowManagementPage } from './pages/kiosk/KioskWindowManagementPage';
import {
  ModulePlaceholderPage,
} from './pages/PlaceholderPages';
import { PaymentsPage } from './pages/payments/PaymentsPage';
import { IntegrationToolsPage } from './pages/integration-tools/IntegrationToolsPage';
import { OrdersPage } from './pages/orders/OrdersPage';
import { OrderTabletPage } from './pages/order-tablet/OrderTabletPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { StaffPage } from './pages/staff/StaffPage';
import { CredentialSetupPage } from './pages/staff/CredentialSetupPage';
import { AuditLogsPage } from './pages/audit/AuditLogsPage';
import { TableManagementPage as LiveTableManagementPage } from './pages/table-management/TableManagementPage';
import { TabletDevicesPage } from './pages/tablet-devices/TabletDevicesPage';


function Spinner() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <svg
        className="animate-spin h-8 w-8 text-emerald-600"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-label="Loading"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );
}

export function App() {
  if (import.meta.env.VITE_APP_MODE === 'kds') {
    return (
      <KdsPinGate>
        <div style={{ width: '100vw', height: '100vh', display: 'flex', overflow: 'hidden', background: 'var(--color-bg)' }}>
          <KitchenDisplayPage />
        </div>
      </KdsPinGate>
    );
  }

  if (import.meta.env.VITE_APP_MODE === 'tablet') {
    return (
      <TabletDeviceGate>
        <div style={{ width: '100vw', height: '100vh', display: 'flex', overflow: 'hidden', background: 'var(--color-bg)' }}>
          <OrderTabletPage standalone={true} />
        </div>
      </TabletDeviceGate>
    );
  }

  return <AdminPortalApp />;
}

function AdminPortalApp() {
  const { isLoading } = useBootstrapAuth();

  if (isLoading) return <Spinner />;

  return (
    <BrowserRouter>
      <Routes>
        {/* Story 8.1: public — a staff member sets their own password with a setup code. */}
        <Route path="/setup-credential" element={<CredentialSetupPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AdminLayout />}>
            <Route path="/login" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/reservations" element={<ReservationsPage />} />
            <Route path="/table-management" element={<LiveTableManagementPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/kitchen-display" element={<KitchenDisplayPage />} />
            <Route path="/menu-management" element={<MenuManagementPage />} />
            <Route path="/pos-catalog-review" element={<PosCatalogReviewPage />} />

            <Route path="/kiosk-window" element={<KioskWindowManagementPage />} />
            <Route path="/order-tablet" element={<OrderTabletPage />} />
            <Route path="/kiosks" element={<Navigate to="/kiosk-window" replace />} />

            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/venue" element={<VenueSettingsPage />} />
            <Route path="/settings/venue" element={<Navigate to="/venue" replace />} />
            <Route path="/settings/tables" element={<TableManagementPage />} />
            <Route path="/settings/tablet-devices" element={<TabletDevicesPage />} />

            <Route path="/printers" element={<ModulePlaceholderPage name="Printers" />} />
            <Route path="/pos-sync" element={<ModulePlaceholderPage name="POS Sync" />} />
            <Route path="/IntegrationTools" element={<IntegrationToolsPage />} />
            <Route path="/audit" element={<AuditLogsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
