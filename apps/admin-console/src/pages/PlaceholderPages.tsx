import { useNavigate } from 'react-router-dom';

export function ModulePlaceholderPage({ name }: { name: string }) {
  const navigate = useNavigate();
  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto bg-white border border-gray-200 rounded-xl p-8 shadow-sm text-center">
        <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-2">{name} Module</h3>
        <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
          This surface is part of the Verdura platform. The Dashboard, Reservations, and Menu Category Management are wired to live backend database services.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}


export function KiosksPage() {
  const KiosksScreen = (window as any).KiosksScreen;
  return KiosksScreen ? <KiosksScreen /> : <ModulePlaceholderPage name="Kiosk Window" />;
}

export function PaymentsPage() {
  const PaymentsScreen = (window as any).PaymentsScreen;
  return PaymentsScreen ? <PaymentsScreen /> : <ModulePlaceholderPage name="Payments" />;
}
