import { Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { AdminPinGate } from './AdminPinGate';

export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);

  if (!accessToken) {
    return <AdminPinGate />;
  }

  return <Outlet />;
}
