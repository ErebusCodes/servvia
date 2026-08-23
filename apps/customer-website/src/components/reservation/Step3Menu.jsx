import { useState, useEffect } from 'react';
import { ChevronDown, Plus, Minus, Copy, SkipForward, Trash2 } from 'lucide-react';
import { getAuthoritativeMenu, formatMenuForReservation } from '../../shared/menu/menuClient.js';
import { sortMenuItemsAlphabetically } from '../../shared/menu/menuData.js';

function GuestMenuCard({ guest, index, selections, onUpdate, onDuplicate, onSkip, skipped, guestCount, menu = [] }) {
  const [expanded, setExpanded] = useState(index === 0);

  function addItem(item) {
    onUpdate([...selections, { ...item, uid: Date.now() + Math.random() }]);
  }
  function decreaseItem(itemId) {
    const index = selections.findLastIndex(item => item.id === itemId);
    if (index < 0) return;
    onUpdate(selections.filter((_, selectionIndex) => selectionIndex !== index));
  }
  function removeItem(itemId) {
    onUpdate(selections.filter(item => item.id !== itemId));
  }
  function clearSelection() {
    if (!window.confirm(`Clear all ${selections.length} selected item${selections.length === 1 ? '' : 's'} for ${guest.name || `Guest ${index + 1}`}?`)) return;
    onUpdate([]);
  }

  const subtotal = selections.reduce((s, i) => s + i.price, 0);
  const groupedSelections = sortMenuItemsAlphabetically(Array.from(
    selections.reduce((groups, item) => {
      const current = groups.get(item.id);
      groups.set(item.id, current
        ? { ...current, quantity: current.quantity + 1 }
        : { ...item, quantity: 1 });
      return groups;
    }, new Map()).values()
  ));

  return (
    <div className={`border rounded-sm transition-all duration-300 ${skipped ? 'border-border/15 opacity-60' : 'border-border/25 bg-card/20'}`}>
      {/* Header */}
      <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5">
        <button
          type="button"
          className="flex w-full sm:flex-1 items-center gap-3 text-left"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded && !skipped}
        >
          <div className="w-8 h-8 rounded-sm border border-border/30 bg-card flex items-center justify-center font-body text-xs text-muted-foreground">{index + 1}</div>
          <div>
            <p className="font-display text-sm text-foreground tracking-wide">{guest.name || `Guest ${index + 1}`}</p>
            <p className="font-body text-[10px] text-muted-foreground">{skipped ? 'Ordering at table' : `${selections.length} items · $${subtotal.toFixed(2)}`}</p>
          </div>
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!skipped && guestCount > 1 && (
            <button type="button" onClick={() => onDuplicate(index)}
              className="flex items-center gap-1 font-body text-[10px] text-muted-foreground hover:text-foreground transition-colors border border-border/20 px-2 py-1 rounded-sm">
              <Copy size={9} /> Copy
            </button>
          )}
          {!skipped && selections.length > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="flex items-center gap-1 font-body text-[10px] text-muted-foreground hover:text-destructive transition-colors border border-border/20 px-2 py-1 rounded-sm"
              aria-label={`Clear all menu selections for ${guest.name || `Guest ${index + 1}`}`}
            >
              <Trash2 size={10} /> Clear
            </button>
          )}
          <button type="button" onClick={() => onSkip(index)}
            className={`flex items-center gap-1 font-body text-[10px] transition-colors border px-2 py-1 rounded-sm ${skipped ? 'border-accent/40 text-accent' : 'border-border/20 text-muted-foreground hover:text-foreground'}`}>
            <SkipForward size={9} /> {skipped ? 'Unskip' : 'Skip'}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="min-w-[44px] h-11 flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} menu for ${guest.name || `Guest ${index + 1}`}`}
            aria-expanded={expanded && !skipped}
          >
            <ChevronDown size={14} className={`transition-transform duration-200 ${expanded && !skipped ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Selected items */}
      {!skipped && expanded && (
        <div className="px-5 pb-5 space-y-5">
          {selections.length > 0 && (
            <div className="border-t border-border/15 pt-4 space-y-1.5">
              <p className="font-body text-[9px] tracking-[0.2em] text-muted-foreground uppercase mb-2">Selected</p>
              {groupedSelections.map(item => (
                <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-accent/5 border border-accent/15 px-3 py-3 rounded-sm">
                  <div className="min-w-0">
                    <p className="font-body text-sm font-semibold text-foreground leading-snug">{item.name}</p>
                    <p className="font-body text-[10px] text-muted-foreground mt-0.5">
                      {item.quantity} × ${item.price.toFixed(2)} each
                    </p>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0">
                    <span className="font-body text-sm font-semibold text-accent min-w-[72px]">
                      ${(item.price * item.quantity).toFixed(2)}
                    </span>
                    <div className="flex items-center gap-1" aria-label={`Quantity controls for ${item.name}`}>
                      <button
                        type="button"
                        onClick={() => decreaseItem(item.id)}
                        className="min-w-[44px] h-11 border border-border/30 rounded-sm flex items-center justify-center text-muted-foreground hover:border-accent/50 hover:text-accent transition-all"
                        aria-label={`Decrease ${item.name} quantity`}
                      >
                        <Minus size={15} />
                      </button>
                      <span className="font-body text-sm font-semibold text-foreground tabular-nums w-8 text-center" aria-label={`Quantity ${item.quantity}`}>
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => addItem(item)}
                        className="min-w-[44px] h-11 border border-border/30 rounded-sm flex items-center justify-center text-muted-foreground hover:border-accent/50 hover:text-accent transition-all"
                        aria-label={`Increase ${item.name} quantity`}
                      >
                        <Plus size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="min-w-[44px] h-11 border border-transparent rounded-sm flex items-center justify-center text-muted-foreground hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive transition-all"
                        aria-label={`Remove ${item.name} from selection`}
                        title="Remove item"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex justify-between pt-2 border-t border-border/15">
                <span className="font-body text-[10px] text-muted-foreground uppercase tracking-wider">Subtotal</span>
                <span className="font-display text-sm text-accent">${subtotal.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Menu sections */}
          {menu.map(section => (
            <MenuSection key={section.category} section={section} onAdd={addItem} selections={selections} />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuSection({ section, onAdd, selections }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/15 rounded-sm">
      <button className="w-full flex items-center justify-between px-4 py-3 text-left" onClick={() => setOpen(!open)}>
        <span className="font-body text-[10px] tracking-[0.2em] text-muted-foreground uppercase">{section.category}</span>
        <ChevronDown size={12} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border/10 divide-y divide-border/10">
          {section.items.map(item => {
            const count = selections.filter(s => s.id === item.id).length;
            return (
              <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-body text-xs text-foreground">{item.name}</p>
                  <p className="font-body text-[10px] text-muted-foreground italic">{item.desc}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-body text-xs text-accent">${item.price}</span>
                  <button onClick={() => onAdd(item)}
                    className="min-w-[44px] h-11 border border-border/30 rounded-sm flex items-center justify-center text-muted-foreground hover:border-accent/50 hover:text-accent transition-all"
                    aria-label={`Add ${item.name}`}>
                    <Plus size={15} />
                  </button>
                  {count > 0 && <span className="font-body text-[10px] text-accent w-3">{count}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Step3Menu({ reservation, update, onNext, onBack, menuTotal }) {
  const guests = reservation.guestSetup || [];
  const menuSelections = reservation.menuSelections || {};
  const [skipped, setSkipped] = useState({});
  const [dynamicMenu, setDynamicMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [menuError, setMenuError] = useState(null);

  useEffect(() => {
    async function fetchMenu() {
      try {
        const { categories, items } = await getAuthoritativeMenu();
        const formatted = formatMenuForReservation(categories, items);
        setDynamicMenu(formatted);
        setMenuError(null);
      } catch (e) {
        console.error("Failed to load menu for reservation", e);
        setMenuError('The pre-order menu is temporarily unavailable. You can continue without a pre-order or go back and try again.');
      } finally {
        setLoading(false);
      }
    }
    fetchMenu();
  }, []);

  function updateGuestMenu(guestIdx, items) {
    update({ menuSelections: { ...menuSelections, [guestIdx]: items } });
  }

  function duplicateGuestOrder(fromIdx) {
    const source = menuSelections[fromIdx] || [];
    const updated = { ...menuSelections };
    guests.forEach((_, i) => { if (i !== fromIdx) updated[i] = source.map(item => ({ ...item, uid: Date.now() + Math.random() })); });
    update({ menuSelections: updated });
  }

  function toggleSkip(idx) {
    setSkipped(prev => ({ ...prev, [idx]: !prev[idx] }));
    if (!skipped[idx]) updateGuestMenu(idx, []);
  }

  return (
    <div className="space-y-6 pb-24 xl:pb-0">
      <div>
        <h2 className="font-display text-2xl md:text-3xl tracking-wide text-foreground mb-1">Menu Selections</h2>
        <p className="font-body text-sm text-muted-foreground">Pre-order for each guest — or skip to order at the table</p>
      </div>

      {menuTotal > 0 && (
        <div className="flex items-center justify-between border border-accent/20 bg-accent/5 rounded-sm px-5 py-3">
          <span className="font-body text-xs tracking-wider text-muted-foreground uppercase">Running Total</span>
          <span className="font-display text-lg text-accent">${menuTotal.toFixed(2)}</span>
        </div>
      )}

      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-6 w-6 text-accent rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : menuError ? (
          <div role="alert" className="border border-red-400/30 bg-red-950/20 rounded-sm px-5 py-4">
            <p className="font-body text-sm text-red-200">{menuError}</p>
          </div>
        ) : (
          guests.map((guest, i) => (
            <GuestMenuCard
              key={i}
              guest={guest}
              index={i}
              selections={menuSelections[i] || []}
              onUpdate={items => updateGuestMenu(i, items)}
              onDuplicate={duplicateGuestOrder}
              onSkip={toggleSkip}
              skipped={!!skipped[i]}
              guestCount={guests.length}
              menu={dynamicMenu}
            />
          ))
        )}
      </div>

      <div className="flex items-center justify-between pt-4">
        <button onClick={onBack} className="font-body text-xs tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors">← Back</button>
        <button onClick={onNext} className="font-body text-xs tracking-[0.2em] uppercase bg-foreground text-background px-8 py-3.5 hover:bg-foreground/90 transition-colors">
          Review Reservation →
        </button>
      </div>
    </div>
  );
}
