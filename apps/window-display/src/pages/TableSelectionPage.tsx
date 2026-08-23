import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchActiveTables } from '../api/tables';
import { useKioskStore } from '../store/kiosk.store';
import type { Table } from '../types/table';
import { KioskFullscreenShell } from '../components/KioskFullscreenShell';
import { FullscreenGate } from '../components/FullscreenGate';

const VENUE_ID: string | undefined = import.meta.env['VITE_VENUE_ID'];

function TableCard({ table, selected, onSelect }: { table: Table; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`
        flex flex-col items-center justify-center rounded-2xl border-4 p-6 transition-all
        ${selected
          ? 'border-emerald-500 bg-emerald-50 shadow-lg scale-105'
          : 'border-gray-200 bg-white hover:border-emerald-300 hover:shadow'}
      `}
    >
      <span className="text-4xl font-extrabold text-gray-800">{table.tableNumber}</span>
      {table.name && <span className="mt-1 text-sm text-gray-500">{table.name}</span>}
      <span className="mt-2 text-xs text-gray-400">{table.capacity} seats</span>
    </button>
  );
}

export function TableSelectionPage() {
  const { selectedTable, setSelectedTable, orderType, setOrderType, clearSelection } = useKioskStore();
  const navigate = useNavigate();

  const { data: tables, isLoading, isError } = useQuery({
    queryKey: ['kiosk', 'tables', VENUE_ID],
    queryFn: () => fetchActiveTables(VENUE_ID!),
    enabled: Boolean(VENUE_ID),
  });

  if (!VENUE_ID) {
    return (
      <KioskFullscreenShell safeArea className="flex items-center justify-center">
        <p className="text-red-500 text-lg">VITE_VENUE_ID is not configured.</p>
      </KioskFullscreenShell>
    );
  }

  if (isLoading) {
    return (
      <KioskFullscreenShell safeArea className="flex items-center justify-center">
        <p className="text-gray-400 text-lg animate-pulse">Loading tables…</p>
      </KioskFullscreenShell>
    );
  }

  if (isError || !tables) {
    return (
      <KioskFullscreenShell safeArea className="flex items-center justify-center">
        <p className="text-red-500 text-lg">Unable to load tables. Please try again.</p>
      </KioskFullscreenShell>
    );
  }

  if (tables.length === 0) {
    return (
      <KioskFullscreenShell safeArea className="flex items-center justify-center">
        <p className="text-gray-500 text-lg">No tables available. Please speak to a staff member.</p>
      </KioskFullscreenShell>
    );
  }

  return (
    <KioskFullscreenShell safeArea className="bg-gray-50">
      <FullscreenGate variant="button" />
      <div className="h-full w-full overflow-y-auto flex flex-col items-center px-6 py-12">
      <h1 className="text-4xl font-extrabold text-gray-800 mb-2">Welcome to Verdura</h1>
      <p className="text-gray-400 mb-6">Choose your order type below</p>

      {/* Dine-in vs Takeaway Selection Tabs */}
      <div className="flex gap-4 mb-10 w-full max-w-md justify-center">
        <button
          onClick={() => {
            clearSelection();
            setOrderType('Dine-in');
          }}
          className={`flex-1 py-3.5 font-bold rounded-2xl transition cursor-pointer text-center ${
            orderType === 'Dine-in'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-white text-gray-700 border border-gray-200 hover:border-emerald-300'
          }`}
        >
          🍽️ Dine-in
        </button>
        <button
          onClick={() => {
            setOrderType('Takeaway');
          }}
          className={`flex-1 py-3.5 font-bold rounded-2xl transition cursor-pointer text-center ${
            orderType === 'Takeaway'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-white text-gray-700 border border-gray-200 hover:border-emerald-300'
          }`}
        >
          🛍️ Takeaway
        </button>
      </div>

      {orderType === 'Takeaway' ? (
        <div className="mt-4 flex flex-col items-center gap-4 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm max-w-sm w-full text-center">
          <span className="text-5xl">🛍️</span>
          <h3 className="text-gray-800 font-extrabold text-xl mt-2">Takeaway</h3>
          <p className="text-gray-400 text-sm mb-2">Order will be prepared for pickup/delivery</p>
          <button
            onClick={() => navigate('/order')}
            className="w-full px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-bold rounded-xl shadow-md transition active:scale-95 cursor-pointer"
          >
            Start Order
          </button>
        </div>
      ) : (
        <>
          <p className="text-gray-500 font-medium mb-4">Please select your table number:</p>
          <div className="grid grid-cols-3 gap-4 w-full max-w-2xl sm:grid-cols-4">
            {tables.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                selected={selectedTable?.id === table.id}
                onSelect={() =>
                  selectedTable?.id === table.id ? clearSelection() : setSelectedTable(table)
                }
              />
            ))}
          </div>

          {selectedTable && (
            <div className="mt-10 flex flex-col items-center gap-4">
              <p className="text-emerald-700 font-semibold text-lg">
                Table {selectedTable.tableNumber} selected
              </p>
              <button
                onClick={() => navigate('/order')}
                className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-bold rounded-xl shadow-md transition active:scale-95 cursor-pointer"
              >
                Start Order
              </button>
              <button
                className="text-sm text-gray-400 underline cursor-pointer"
                onClick={clearSelection}
              >
                Clear selection
              </button>
            </div>
          )}
        </>
      )}
      </div>
    </KioskFullscreenShell>
  );
}
