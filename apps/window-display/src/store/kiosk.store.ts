import { create } from 'zustand';
import type { Table } from '../types/table';
import type { CartItem, MenuItem } from '../types/menu';

interface KioskState {
  selectedTable: Table | null;
  orderType: 'Dine-in' | 'Takeaway';
  cart: CartItem[];
  setSelectedTable: (table: Table | null) => void;
  setOrderType: (type: 'Dine-in' | 'Takeaway') => void;
  clearSelection: () => void;
  addToCart: (menuItem: MenuItem, quantity: number, selectedModifiers: { name: string; priceDeltaCents: number }[], notes: string) => void;
  removeFromCart: (cartItemId: string) => void;
  updateCartQuantity: (cartItemId: string, quantity: number) => void;
  clearCart: () => void;
}

const generateCartItemId = (
  menuItemId: string,
  modifiers: { name: string; priceDeltaCents: number }[],
  notes: string,
): string => {
  const modHash = modifiers
    .map((m) => m.name)
    .sort()
    .join('|');
  return `${menuItemId}-${modHash}-${notes}`;
};

export const useKioskStore = create<KioskState>((set) => ({
  selectedTable: null,
  orderType: 'Dine-in',
  cart: [],
  setSelectedTable: (table) => set({ selectedTable: table, orderType: 'Dine-in' }),
  setOrderType: (type) => set((state) => ({ orderType: type, selectedTable: type === 'Takeaway' ? null : state.selectedTable })),
  clearSelection: () => set({ selectedTable: null, orderType: 'Dine-in' }),
  addToCart: (menuItem, quantity, selectedModifiers, notes) =>
    set((state) => {
      const cartItemId = generateCartItemId(menuItem.id, selectedModifiers, notes);
      const existingIndex = state.cart.findIndex((item) => item.id === cartItemId);
      const updatedCart = [...state.cart];

      if (existingIndex > -1) {
        const existingItem = updatedCart[existingIndex];
        if (existingItem) {
          updatedCart[existingIndex] = {
            ...existingItem,
            quantity: existingItem.quantity + quantity,
          };
        }
      } else {
        updatedCart.push({
          id: cartItemId,
          menuItem,
          quantity,
          selectedModifiers,
          notes,
        });
      }
      return { cart: updatedCart };
    }),
  removeFromCart: (cartItemId) =>
    set((state) => ({
      cart: state.cart.filter((item) => item.id !== cartItemId),
    })),
  updateCartQuantity: (cartItemId, quantity) =>
    set((state) => ({
      cart: state.cart
        .map((item) => (item.id === cartItemId ? { ...item, quantity } : item))
        .filter((item) => item.quantity > 0),
    })),
  clearCart: () => set({ cart: [] }),
}));
