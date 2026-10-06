import { Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { StaffSignIn } from './StaffSignIn';

export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);

  if (!accessToken) {
    return <StaffSignIn />;
  }

  return <Outlet />;
}
