import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

interface Table {
  id: string;
  venueId: string;
  tableNumber: string;
  name: string | null;
  capacity: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface Venue {
  id: string;
  name: string;
}

export function TableManagementPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isAuthorized = currentUser?.role === 'owner' || currentUser?.role === 'admin';

  // Modal & Edit State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form states
  const [tableNumber, setTableNumber] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch venues to resolve active venue
  const { data: venues, isLoading: isVenuesLoading } = useQuery<Venue[]>({
    queryKey: ['venues'],
    queryFn: () => api.get('/api/venues').then((res) => res.data),
  });

  const venueId = venues?.[0]?.id;

  // Fetch tables for the active venue
  const { data: tables, isLoading: isTablesLoading } = useQuery<Table[]>({
    queryKey: ['tables', venueId],
    queryFn: () => api.get(`/api/venues/${venueId}/tables`).then((res) => res.data),
    enabled: !!venueId,
  });

  const createMutation = useMutation({
    mutationFn: (dto: { tableNumber: string; capacity: number; isActive: boolean; sortOrder: number }) =>
      api.post(`/api/venues/${venueId}/tables`, dto),
    onSuccess: () => {
      setIsAddOpen(false);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['tables', venueId] });
      resetForm();
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.message || 'Failed to create table');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: string; dto: Partial<Table> }) =>
      api.patch(`/api/venues/${venueId}/tables/${args.id}`, args.dto),
    onSuccess: () => {
      setEditingTable(null);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['tables', venueId] });
      resetForm();
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.message || 'Failed to update table');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/venues/${venueId}/tables/${id}`),
    onSuccess: () => {
      setDeleteConfirmId(null);
      void queryClient.invalidateQueries({ queryKey: ['tables', venueId] });
    },
    onError: (err: any) => {
      alert(err.response?.data?.message || 'Failed to delete table');
    },
  });

  const resetForm = () => {
    setTableNumber('');
    setCapacity(4);
    setIsActive(true);
    setSortOrder(0);
    setErrorMsg(null);
  };

  const handleOpenAdd = () => {
    resetForm();
    setIsAddOpen(true);
  };

  const handleOpenEdit = (t: Table) => {
    setErrorMsg(null);
    setEditingTable(t);
    setTableNumber(t.tableNumber);
    setCapacity(t.capacity);
    setIsActive(t.isActive);
    setSortOrder(t.sortOrder);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableNumber.trim()) return;
    createMutation.mutate({ tableNumber, capacity, isActive, sortOrder });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTable || !tableNumber.trim()) return;
    updateMutation.mutate({
      id: editingTable.id,
      dto: { tableNumber, capacity, isActive, sortOrder },
    });
  };

  const isLoading = isVenuesLoading || isTablesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!venueId) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <h3 className="font-semibold text-lg">Error loading tables</h3>
          <p className="mt-1 text-sm">Please ensure a venue has been seeded for your organization.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      <div className="sm:flex sm:items-center sm:justify-between border-b border-gray-200 pb-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold text-gray-900 sm:truncate sm:text-3xl tracking-tight">
            Table Management
          </h2>
          <p className="mt-1.5 text-sm text-gray-500">
            Add, configure, and manage physical tables for your venue.
          </p>
        </div>
        {isAuthorized && (
          <div className="mt-4 sm:ml-4 sm:mt-0">
            <button
              onClick={handleOpenAdd}
              className="inline-flex items-center justify-center rounded-md border border-transparent bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors"
            >
              Add Table
            </button>
          </div>
        )}
      </div>

      {!isAuthorized && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 text-amber-800">
          <svg
            className="w-5 h-5 flex-shrink-0 text-amber-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 15v2m0-6v.01M5.938 18h12.125c1.213 0 1.972-1.321 1.353-2.364L13.626 5.864a1.868 1.868 0 00-2.706 0L5.138 15.636C4.52 16.679 5.279 18 6.49 18z"
            />
          </svg>
          <div>
            <h4 className="font-semibold text-sm">View-Only Access</h4>
            <p className="mt-1 text-xs">
              Only owners and administrators can add, edit, or remove tables. Your role is:{' '}
              <span className="capitalize font-semibold">{currentUser?.role}</span>.
            </p>
          </div>
        </div>
      )}

      {/* Tables List */}
      <div className="mt-6 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6"
                    >
                      Table Number
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Capacity
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Sort Order
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Status
                    </th>
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {tables && tables.length > 0 ? (
                    tables.map((t) => (
                      <tr key={t.id}>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-bold text-gray-900 sm:pl-6">
                          Table {t.tableNumber}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                          {t.capacity} covers
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                          {t.sortOrder}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              t.isActive
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {t.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          {isAuthorized ? (
                            <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => handleOpenEdit(t)}
                                className="text-emerald-600 hover:text-emerald-900"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(t.id)}
                                className="text-red-600 hover:text-red-900"
                              >
                                Delete
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">No permissions</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-gray-500">
                        No tables created yet. Click "Add Table" to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Add Table Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl border border-gray-200 max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900">Add New Table</h3>
              {errorMsg && (
                <div className="mt-3 bg-red-50 text-red-700 text-xs font-medium p-3 rounded-md">
                  {errorMsg}
                </div>
              )}
              <form onSubmit={handleAddSubmit} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="number" className="block text-xs font-semibold text-gray-700">
                    Table Number
                  </label>
                  <input
                    type="text"
                    id="number"
                    value={tableNumber}
                    onChange={(e) => setTableNumber(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
                    placeholder="e.g. 15 or 12A"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="cap" className="block text-xs font-semibold text-gray-700">
                      Capacity
                    </label>
                    <input
                      type="number"
                      id="cap"
                      value={capacity}
                      onChange={(e) => setCapacity(parseInt(e.target.value, 10))}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
                      min="1"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="sort" className="block text-xs font-semibold text-gray-700">
                      Sort Order
                    </label>
                    <input
                      type="number"
                      id="sort"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(parseInt(e.target.value, 10))}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="active"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4 border-gray-300"
                  />
                  <label htmlFor="active" className="text-sm font-semibold text-gray-700">
                    Table is active and available for booking/ordering
                  </label>
                </div>
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-150">
                  <button
                    type="button"
                    onClick={() => setIsAddOpen(false)}
                    className="px-4 py-2 text-xs font-semibold text-gray-750 hover:bg-gray-100 rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm transition-colors disabled:opacity-50"
                  >
                    {createMutation.isPending ? 'Creating…' : 'Add Table'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Table Modal */}
      {editingTable && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl border border-gray-200 max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900">Edit Table {editingTable.tableNumber}</h3>
              {errorMsg && (
                <div className="mt-3 bg-red-50 text-red-700 text-xs font-medium p-3 rounded-md">
                  {errorMsg}
                </div>
              )}
              <form onSubmit={handleEditSubmit} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="edit_number" className="block text-xs font-semibold text-gray-700">
                    Table Number
                  </label>
                  <input
                    type="text"
                    id="edit_number"
                    value={tableNumber}
                    onChange={(e) => setTableNumber(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="edit_cap" className="block text-xs font-semibold text-gray-700">
                      Capacity
                    </label>
                    <input
                      type="number"
                      id="edit_cap"
                      value={capacity}
                      onChange={(e) => setCapacity(parseInt(e.target.value, 10))}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
                      min="1"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="edit_sort" className="block text-xs font-semibold text-gray-700">
                      Sort Order
                    </label>
                    <input
                      type="number"
                      id="edit_sort"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(parseInt(e.target.value, 10))}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="edit_active"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4 border-gray-300"
                  />
                  <label htmlFor="edit_active" className="text-sm font-semibold text-gray-700">
                    Table is active and available for booking/ordering
                  </label>
                </div>
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-150">
                  <button
                    type="button"
                    onClick={() => setEditingTable(null)}
                    className="px-4 py-2 text-xs font-semibold text-gray-750 hover:bg-gray-100 rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updateMutation.isPending}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm transition-colors disabled:opacity-50"
                  >
                    {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl border border-gray-200 max-w-sm w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900">Delete Table</h3>
              <p className="mt-2 text-sm text-gray-500">
                Are you sure you want to permanently delete this table? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-gray-150">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(null)}
                  className="px-4 py-2 text-xs font-semibold text-gray-750 hover:bg-gray-100 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate(deleteConfirmId)}
                  disabled={deleteMutation.isPending}
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-650 hover:bg-red-700 rounded-md shadow-sm transition-colors disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
