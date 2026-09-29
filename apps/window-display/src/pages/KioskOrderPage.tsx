import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadStripeTerminal } from '@stripe/terminal-js';
import { fetchVenueMenu, submitKioskOrder } from '../api/menu';
import { useKioskStore } from '../store/kiosk.store';
import type { MenuItem, ModifierOption } from '../types/menu';
import { compareMenuItemsAlphabetically } from '../../../../shared/menu/menuData.mjs';
import { KioskFullscreenShell } from '../components/KioskFullscreenShell';
import { FullscreenGate } from '../components/FullscreenGate';

const VENUE_ID = import.meta.env['VITE_VENUE_ID'] || '';
const API_BASE = import.meta.env['VITE_API_URL'] || '';

export function KioskOrderPage({ onBackToTables }: { onBackToTables: () => void }) {
  const { selectedTable, cart, addToCart, removeFromCart, updateCartQuantity, clearCart } = useKioskStore();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [activeItemForModifiers, setActiveItemForModifiers] = useState<MenuItem | null>(null);
  
  // Modifiers state
  const [modifierSelections, setModifierSelections] = useState<ModifierOption[]>([]);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemNotes, setItemNotes] = useState('');

  // Checkout flow state
  const [checkoutStep, setCheckoutStep] = useState<'idle' | 'stripe-connect' | 'stripe-tap' | 'stripe-authorizing' | 'success' | 'error'>('idle');
  const [stripeTerminalError, setStripeTerminalError] = useState<string | null>(null);
  const [createdOrderRef, setCreatedOrderRef] = useState<any>(null);

  const { data: menuData, isLoading, isError } = useQuery({
    queryKey: ['kiosk', 'menu', VENUE_ID],
    queryFn: () => fetchVenueMenu(VENUE_ID),
    enabled: Boolean(VENUE_ID),
  });

  // Hooks must run in the same order on every render. Derive safe empty
  // collections before the loading/error early returns so the first successful
  // menu response cannot trigger React's "Rendered more hooks" failure.
  const { categories, menuItems } = useMemo(() => {
    if (!menuData) return { categories: [], menuItems: [] };
    const sortedCategories = [...menuData.categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const sortedMenuItems = [...menuData.menuItems].sort(compareMenuItemsAlphabetically);
    return { categories: sortedCategories, menuItems: sortedMenuItems };
  }, [menuData]);

  if (isLoading) {
    return (
      <KioskFullscreenShell safeArea className="bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-emerald-400 text-lg font-medium animate-pulse">Loading Servvia Kiosk menu…</p>
        </div>
      </KioskFullscreenShell>
    );
  }

  if (isError || !menuData) {
    return (
      <KioskFullscreenShell safeArea className="bg-gray-950 flex flex-col items-center justify-center px-4">
        <div className="p-8 bg-red-950/30 border border-red-500/30 rounded-3xl text-center max-w-md">
          <span className="text-5xl">⚠️</span>
          <h2 className="text-2xl font-bold text-red-400 mt-4 mb-2">Failed to Load Menu</h2>
          <p className="text-red-300/80 mb-6">We encountered an issue fetching the menu catalog. Please notify a cashier or server.</p>
          <button onClick={onBackToTables} className="px-6 py-3 bg-red-800 text-white rounded-xl font-bold hover:bg-red-700">
            Back to Home
          </button>
        </div>
      </KioskFullscreenShell>
    );
  }

  const currentCategory = selectedCategoryId || categories[0]?.id;
  const filteredItems = menuItems.filter(item => item.categoryId === currentCategory);

  const cartSubtotal = cart.reduce((sum, item) => {
    const modsPrice = item.selectedModifiers.reduce((s, m) => s + m.priceDeltaCents, 0);
    return sum + (item.menuItem.priceCents + modsPrice) * item.quantity;
  }, 0);

  const cartTax = Math.round(cartSubtotal * 0.15);
  const cartTotal = cartSubtotal + cartTax;

  const handleOpenModifiers = (item: MenuItem) => {
    setActiveItemForModifiers(item);
    setModifierSelections([]);
    setItemQuantity(1);
    setItemNotes('');
  };

  const handleToggleModifier = (option: ModifierOption) => {
    setModifierSelections(prev => {
      const exists = prev.find(o => o.name === option.name);
      if (exists) {
        return prev.filter(o => o.name !== option.name);
      } else {
        return [...prev, option];
      }
    });
  };

  const handleAddToCart = () => {
    if (!activeItemForModifiers) return;
    addToCart(activeItemForModifiers, itemQuantity, modifierSelections, itemNotes);
    setActiveItemForModifiers(null);
  };

  const simulatePaymentSuccess = async () => {
    if (import.meta.env.MODE === 'production') {
      console.error('Payment simulation is not allowed in production.');
      return;
    }
    setCheckoutStep('stripe-authorizing');
    
    // Create the order payload
    const orderPayload = {
      venueId: VENUE_ID,
      tableId: selectedTable?.id,
      tableNumber: selectedTable?.tableNumber,
      notes: 'Kiosk Checkout Order',
      stripePaymentIntentId: 'pi_kiosk_' + Math.random().toString(36).substring(2, 10),
      items: cart.map(item => ({
        menuItemId: item.menuItem.id,
        quantity: item.quantity,
        selectedModifiers: item.selectedModifiers.map(mod => ({
          name: mod.name,
          priceDeltaCents: mod.priceDeltaCents,
        })),
        notes: item.notes,
      })),
    };

    try {
      // 1. Submit order to NestJS endpoint which validates payment match and overrides
      const response = await submitKioskOrder(orderPayload);
      setCreatedOrderRef(response);
      
      // 2. Transaction successful
      setTimeout(() => {
        setCheckoutStep('success');
      }, 1000);
    } catch (err: any) {
      setStripeTerminalError(err.message || 'Payment authentication failed');
      setCheckoutStep('error');
    }
  };

  // Real Stripe Terminal payment process
  const processStripeTerminalPayment = async () => {
    if (cart.length === 0) return;
    setCheckoutStep('stripe-connect');
    setStripeTerminalError(null);

    try {
      // 1. Load the Stripe Terminal JS SDK
      const StripeTerminal = await loadStripeTerminal();
      if (!StripeTerminal) {
        throw new Error('Failed to load Stripe Terminal SDK');
      }

      // 2. Initialize Terminal Instance
      const terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const res = await fetch(`${API_BASE}/api/kiosk/stripe/connection-token`, { method: 'POST' });
          if (!res.ok) throw new Error('Failed to fetch connection token');
          const data = await res.json();
          return data.secret;
        },
        onUnexpectedReaderDisconnect: () => {
          console.warn('Stripe Terminal reader disconnected');
        },
      });

      // 3. Discover readers
      const discoverResult = (await terminal.discoverReaders({
        discoveryMethod: 'internet',
      } as any)) as any;

      if (discoverResult.error) {
        throw new Error(`Reader discovery failed: ${discoverResult.error.message}`);
      }

      if (!discoverResult.readers || discoverResult.readers.length === 0) {
        // Dev / Local Sandbox fallback simulation if no physical reader is on the local network
        if (import.meta.env.MODE !== 'production') {
          console.log('[Dev Sandbox Fallback]: No physical reader found. Proceeding with simulated reader.');
          setTimeout(() => {
            setCheckoutStep('stripe-tap');
          }, 1000);
          return;
        }
        throw new Error('No active Stripe Terminal readers found on the local network');
      }

      // 4. Connect to first reader found
      const connectedReader = discoverResult.readers[0];
      if (!connectedReader) throw new Error('Reader is undefined');
      const connectResult = (await terminal.connectReader(connectedReader)) as any;
      if (connectResult.error) {
        throw new Error(`Reader connection failed: ${connectResult.error.message}`);
      }

      // 5. Create PaymentIntent on Backend
      setCheckoutStep('stripe-tap');
      const createRes = await fetch(`${API_BASE}/api/kiosk/stripe/create-payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: cartTotal }),
      });
      if (!createRes.ok) throw new Error('Backend failed to create payment intent');
      const { clientSecret } = await createRes.json();
      if (!clientSecret) throw new Error('No client secret returned from payment intent creation');

      // 6. Collect Payment Method
      const collectResult = (await terminal.collectPaymentMethod(clientSecret)) as any;
      if (collectResult.error) {
        throw new Error(`Payment method collection aborted: ${collectResult.error.message}`);
      }

      // 7. Process Payment
      setCheckoutStep('stripe-authorizing');
      const processResult = (await terminal.processPayment(collectResult.paymentIntent)) as any;
      if (processResult.error) {
        throw new Error(`Payment authorization failed: ${processResult.error.message}`);
      }

      // 8. Confirm order creation on backend with the authorized payment intent id
      const orderPayload = {
        venueId: VENUE_ID,
        tableId: selectedTable?.id,
        tableNumber: selectedTable?.tableNumber,
        notes: 'Kiosk Checkout Order (Stripe Terminal Authorized)',
        stripePaymentIntentId: processResult.paymentIntent.id,
        items: cart.map(item => ({
          menuItemId: item.menuItem.id,
          quantity: item.quantity,
          selectedModifiers: item.selectedModifiers.map(mod => ({
            name: mod.name,
            priceDeltaCents: mod.priceDeltaCents,
          })),
          notes: item.notes,
        })),
      };

      const response = await submitKioskOrder(orderPayload);
      setCreatedOrderRef(response);
      setCheckoutStep('success');

    } catch (err: any) {
      console.error('Stripe Terminal payment error:', err);
      setStripeTerminalError(err.message || 'Transaction processing failed');
      setCheckoutStep('error');
    }
  };

  const handleCloseConfirmation = () => {
    clearCart();
    setCheckoutStep('idle');
    setCreatedOrderRef(null);
    onBackToTables(); // Go back to table selection for next customer
  };

  return (
    <KioskFullscreenShell safeArea className="bg-gray-950 text-white flex flex-col font-sans">
      <FullscreenGate variant="button" />
      {/* Header bar */}
      <header className="px-6 py-4 bg-gray-900/60 backdrop-blur-md border-b border-gray-800 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black tracking-wider text-emerald-500">SERVVIA</span>
          <span className="text-xs bg-emerald-500/20 text-emerald-400 font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30">KIOSK</span>
        </div>
        
        {!selectedTable ? (
          <div className="flex items-center gap-4">
            <div className="px-4 py-2 bg-emerald-950/30 border border-emerald-500/30 rounded-xl">
              <span className="text-xs text-emerald-400 block font-medium">ORDER TYPE</span>
              <span className="text-base font-extrabold text-white">Takeaway</span>
            </div>
            <button 
              onClick={onBackToTables}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-xl text-sm font-semibold transition"
            >
              Change Type
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="px-4 py-2 bg-emerald-950/30 border border-emerald-500/30 rounded-xl">
              <span className="text-xs text-emerald-400 block font-medium">TABLE</span>
              <span className="text-base font-extrabold text-white">{selectedTable.tableNumber}</span>
            </div>
            <button 
              onClick={onBackToTables}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-xl text-sm font-semibold transition"
            >
              Change Table
            </button>
          </div>
        )}
      </header>

      {/* Main catalog */}
      <div className="flex-1 flex overflow-hidden">
        {/* Categories navigation sidebar */}
        <aside className="w-64 bg-gray-900/30 border-r border-gray-850 p-4 flex flex-col gap-2 overflow-y-auto">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest px-2 mb-2">Categories</span>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategoryId(cat.id)}
              className={`
                w-full text-left px-4 py-3.5 rounded-2xl text-sm font-bold transition-all flex items-center justify-between
                ${currentCategory === cat.id
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-950/50 scale-[1.02]'
                  : 'text-gray-400 hover:bg-gray-900 hover:text-white'}
              `}
            >
              <span>{cat.name}</span>
              <span className="text-xs opacity-60">
                {menuItems.filter(item => item.categoryId === cat.id).length} items
              </span>
            </button>
          ))}
        </aside>

        {/* Menu Items catalog grid */}
        <main className="flex-1 p-6 overflow-y-auto bg-gray-950/90">
          <h2 className="text-2xl font-black text-white mb-6 flex items-center gap-2">
            <span>{categories.find(c => c.id === currentCategory)?.name || 'Menu'}</span>
            <span className="text-sm bg-gray-800 text-gray-400 px-3 py-1 rounded-full font-bold">
              {filteredItems.length} available
            </span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredItems.map((item) => {
              const basePrice = (item.priceCents / 100).toFixed(2);
              return (
                <div
                  key={item.id}
                  className={`
                    bg-gray-900 border border-gray-800/80 rounded-3xl p-5 flex flex-col justify-between transition-all relative overflow-hidden group
                    ${item.isAvailable ? 'hover:border-emerald-500/50 hover:shadow-xl hover:shadow-emerald-950/20' : 'opacity-65'}
                  `}
                >
                  <div>
                    {item.imageUrl && (
                      <div className="w-full h-40 rounded-2xl overflow-hidden mb-4 bg-gray-800 relative">
                        <img 
                          src={item.imageUrl} 
                          alt={item.title} 
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                        {item.isSpicy && (
                          <span className="absolute top-3 right-3 bg-red-500 text-white text-xs font-black px-2.5 py-1 rounded-full shadow-md">
                            🌶️ SPICY
                          </span>
                        )}
                      </div>
                    )}
                    
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <h3 className="font-extrabold text-lg text-white group-hover:text-emerald-400 transition">
                        {item.title}
                      </h3>
                      {!item.imageUrl && item.isSpicy && (
                        <span className="text-base">🌶️</span>
                      )}
                    </div>
                    
                    <p className="text-gray-400 text-sm line-clamp-3 mb-4 leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-850">
                    <span className="text-xl font-black text-emerald-400">${basePrice}</span>
                    
                    {item.isAvailable ? (
                      <button
                        onClick={() => handleOpenModifiers(item)}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-extrabold rounded-xl shadow-md transition-all active:scale-95"
                      >
                        Add to Order
                      </button>
                    ) : (
                      <span className="text-xs bg-gray-800 text-gray-500 font-bold px-3 py-1.5 rounded-lg border border-gray-700">
                        UNAVAILABLE
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        {/* Right Sticky Cart Sidebar */}
        <aside className="w-80 bg-gray-900/60 backdrop-blur-md border-l border-gray-850 p-6 flex flex-col justify-between sticky right-0">
          <div className="flex-1 flex flex-col overflow-hidden">
            <h3 className="text-lg font-black text-white mb-4 pb-3 border-b border-gray-850 flex items-center justify-between">
              <span>My Cart</span>
              <span className="text-xs bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                {cart.reduce((s, c) => s + c.quantity, 0)} items
              </span>
            </h3>

            {cart.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 p-4">
                <span className="text-4xl mb-3">🥗</span>
                <p className="text-sm font-semibold">Your order is empty</p>
                <p className="text-xs text-gray-600 mt-1">Tap dishes to add them to your cart</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
                {[...cart].sort((a, b) => compareMenuItemsAlphabetically(a.menuItem, b.menuItem)).map((item) => {
                  const modsTotal = item.selectedModifiers.reduce((sum, m) => sum + m.priceDeltaCents, 0);
                  const priceEach = item.menuItem.priceCents + modsTotal;
                  return (
                    <div key={item.id} className="p-3 bg-gray-950/50 rounded-2xl border border-gray-850 flex flex-col gap-2 relative">
                      <button 
                        onClick={() => removeFromCart(item.id)}
                        className="absolute top-2 right-2 text-gray-500 hover:text-red-400 text-xs"
                      >
                        ✕
                      </button>
                      <div className="pr-6">
                        <span className="font-extrabold text-sm text-white block">{item.menuItem.title}</span>
                        {item.selectedModifiers.length > 0 && (
                          <span className="text-xs text-emerald-500 font-medium block mt-0.5">
                            + {item.selectedModifiers.map(m => m.name).join(', ')}
                          </span>
                        )}
                        {item.notes && (
                          <span className="text-xs text-gray-500 italic block mt-0.5">
                            "{item.notes}"
                          </span>
                        )}
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateCartQuantity(item.id, item.quantity - 1)}
                            className="w-7 h-7 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-black text-xs transition"
                          >
                            -
                          </button>
                          <span className="text-sm font-bold text-gray-300 w-4 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateCartQuantity(item.id, item.quantity + 1)}
                            className="w-7 h-7 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-black text-xs transition"
                          >
                            +
                          </button>
                        </div>
                        <span className="font-black text-emerald-400 text-sm">
                          ${((priceEach * item.quantity) / 100).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pricing summary */}
          <div className="mt-6 pt-6 border-t border-gray-850">
            <div className="flex justify-between text-xs text-gray-400 mb-2">
              <span>Subtotal</span>
              <span>${(cartSubtotal / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-400 mb-3">
              <span>GST (15%)</span>
              <span>${(cartTax / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base font-black text-white mb-6">
              <span>Total</span>
              <span className="text-emerald-400 text-lg">${(cartTotal / 100).toFixed(2)}</span>
            </div>

            <button
              onClick={processStripeTerminalPayment}
              disabled={cart.length === 0}
              className={`
                w-full py-4 rounded-2xl font-black text-base tracking-wide shadow-lg transition-all active:scale-98
                ${cart.length > 0
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-emerald-950/40'
                  : 'bg-gray-850 text-gray-600 cursor-not-allowed shadow-none'}
              `}
            >
              PAY & SUBMIT
            </button>
          </div>
        </aside>
      </div>

      {/* Modifiers Modal */}
      {activeItemForModifiers && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="px-6 py-4 bg-gray-850/60 border-b border-gray-850 flex justify-between items-center">
              <h4 className="font-extrabold text-lg text-white">Customize: {activeItemForModifiers.title}</h4>
              <button 
                onClick={() => setActiveItemForModifiers(null)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="p-6 flex flex-col gap-6 overflow-y-auto max-h-[60vh]">
              {/* Modifier Group option checkboxes */}
              <div>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest block mb-3">Add Extras</span>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { name: 'Extra Sauce', priceDeltaCents: 50 },
                    { name: 'Add Avocado', priceDeltaCents: 200 },
                    { name: 'Gluten-Free Bun', priceDeltaCents: 150 },
                    { name: 'Add Jalapeno', priceDeltaCents: 75 },
                  ].map((option) => {
                    const isSelected = Boolean(modifierSelections.find(o => o.name === option.name));
                    return (
                      <button
                        key={option.name}
                        onClick={() => handleToggleModifier(option)}
                        className={`
                          p-3 rounded-2xl border text-left flex justify-between items-center transition-all
                          ${isSelected
                            ? 'bg-emerald-950/40 border-emerald-500 text-white font-bold shadow-md'
                            : 'bg-gray-950 border-gray-850 text-gray-400 hover:border-gray-800'}
                        `}
                      >
                        <span className="text-sm">{option.name}</span>
                        <span className="text-xs text-emerald-400">+${(option.priceDeltaCents / 100).toFixed(2)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cooking notes / Special instructions */}
              <div>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest block mb-2">Special Requests</span>
                <textarea
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  placeholder="e.g. No onions, dressing on side..."
                  maxLength={150}
                  className="w-full bg-gray-950 border border-gray-850 rounded-2xl p-4 text-sm focus:outline-none focus:border-emerald-500 text-gray-300 resize-none h-20"
                />
              </div>

              {/* Quantity */}
              <div className="flex items-center justify-between pt-4 border-t border-gray-850">
                <span className="text-sm font-bold text-gray-300">Quantity</span>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setItemQuantity(q => Math.max(1, q - 1))}
                    className="w-10 h-10 bg-gray-800 hover:bg-gray-750 text-white rounded-xl font-bold flex items-center justify-center text-lg active:scale-95 transition"
                  >
                    -
                  </button>
                  <span className="text-lg font-black text-white w-6 text-center">{itemQuantity}</span>
                  <button
                    onClick={() => setItemQuantity(q => q + 1)}
                    className="w-10 h-10 bg-gray-800 hover:bg-gray-750 text-white rounded-xl font-bold flex items-center justify-center text-lg active:scale-95 transition"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-850/60 border-t border-gray-850 flex justify-end gap-3">
              <button
                onClick={() => setActiveItemForModifiers(null)}
                className="px-5 py-2.5 bg-gray-800 hover:bg-gray-750 text-gray-300 font-bold rounded-xl text-sm transition"
              >
                Cancel
              </button>
              <button
                onClick={handleAddToCart}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl text-sm transition shadow-md"
              >
                Add to Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 6 Stripe Terminal simulation modal */}
      {checkoutStep !== 'idle' && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800/80 rounded-3xl w-full max-w-md p-8 text-center shadow-2xl">
            {checkoutStep === 'stripe-connect' && (
              <div className="py-6">
                <div className="w-16 h-16 border-4 border-dashed border-emerald-500 rounded-full animate-spin mx-auto mb-6"></div>
                <h4 className="text-xl font-extrabold text-white mb-2">Connecting Card Reader</h4>
                <p className="text-gray-400 text-sm">Initializing communication with Stripe Terminal terminal...</p>
              </div>
            )}

            {checkoutStep === 'stripe-tap' && (
              <div className="py-6">
                {/* SVG representing a card reader terminal */}
                <div className="w-20 h-28 bg-gray-850 border border-gray-750 rounded-2xl mx-auto mb-6 p-4 flex flex-col justify-between items-center relative shadow-lg">
                  <div className="w-full h-8 bg-emerald-950/40 rounded border border-emerald-500/20 text-[9px] text-emerald-400 flex items-center justify-center font-mono">
                    INSERT / TAP
                  </div>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping absolute -top-1 -right-1"></div>
                  <div className="flex gap-1.5 justify-center items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  </div>
                </div>
                
                <h4 className="text-2xl font-black text-white mb-2">Present Card</h4>
                <p className="text-emerald-400 font-extrabold text-xl mb-4">${(cartTotal / 100).toFixed(2)}</p>
                <p className="text-gray-400 text-sm mb-6">Tap, insert, or swipe card on the external reader screen</p>
                
                {import.meta.env.MODE !== 'production' && (
                  <button
                    onClick={simulatePaymentSuccess}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-extrabold shadow-md active:scale-95 transition"
                  >
                    SIMULATE CARD TAP
                  </button>
                )}
              </div>
            )}

            {checkoutStep === 'stripe-authorizing' && (
              <div className="py-6">
                <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
                <h4 className="text-xl font-extrabold text-white mb-2">Authorizing Payment</h4>
                <p className="text-gray-400 text-sm">Validating transaction signature and allocating receipt slot...</p>
              </div>
            )}

            {checkoutStep === 'success' && createdOrderRef && (
              <div className="py-6">
                <span className="text-5xl block mb-4">🎉</span>
                <h4 className="text-2xl font-black text-emerald-400 mb-2">Order Confirmed!</h4>
                <p className="text-gray-300 font-bold mb-4">Receipt Ref: #{createdOrderRef.id?.substring(0, 8).toUpperCase()}</p>
                <p className="text-gray-400 text-sm mb-6">Please take your table number locator and seat yourself. Your kitchen receipt is printing.</p>

                <div className="bg-gray-950 p-4 rounded-2xl border border-gray-850 mb-6 text-left max-h-40 overflow-y-auto">
                  <div className="text-xs font-mono text-gray-500 uppercase mb-2">Order Receipt Items</div>
                  {[...cart].sort((a, b) => compareMenuItemsAlphabetically(a.menuItem, b.menuItem)).map(item => (
                    <div key={item.id} className="flex justify-between items-center text-sm mb-1 font-mono text-gray-400">
                      <span>{item.quantity}x {item.menuItem.title}</span>
                      <span>${((item.menuItem.priceCents * item.quantity)/100).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="border-t border-gray-850 mt-3 pt-2 flex justify-between font-mono font-bold text-sm text-emerald-400">
                    <span>Paid Total</span>
                    <span>${(cartTotal / 100).toFixed(2)}</span>
                  </div>
                </div>

                <button
                  onClick={handleCloseConfirmation}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black transition"
                >
                  START NEW ORDER
                </button>
              </div>
            )}

            {checkoutStep === 'error' && (
              <div className="py-6">
                <span className="text-5xl block mb-4">❌</span>
                <h4 className="text-xl font-bold text-red-500 mb-2">Terminal Payment Error</h4>
                <p className="text-red-300 text-sm mb-6">{stripeTerminalError || 'Device timeout or transaction aborted'}</p>
                <button
                  onClick={() => setCheckoutStep('stripe-tap')}
                  className="px-6 py-2.5 bg-gray-850 hover:bg-gray-800 text-white rounded-xl text-sm font-bold transition mr-3"
                >
                  Retry Payment
                </button>
                <button
                  onClick={() => setCheckoutStep('idle')}
                  className="px-6 py-2.5 bg-red-900/40 text-red-400 rounded-xl text-sm font-bold transition"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </KioskFullscreenShell>
  );
}
