import { useState } from 'react';
import { Pencil, Check } from 'lucide-react';
import { sortMenuItemsAlphabetically } from '../../shared/menu/menuData.js';

const POLICY_POINTS = [
  'Reservations may be cancelled without penalty up to 48 hours prior to the scheduled booking date and time.',
  'Any cancellation made within 48 hours of the reservation time shall be considered non-refundable.',
  'In the event of a cancellation within the 48-hour restricted period, all payments, deposits, and associated charges shall be retained and will not be refunded under any circumstances.',
  'By checking the agreement box, the customer confirms that they have read, understood, and accepted the cancellation policy in full.',
];

function Section({ title, onEdit, children }) {
  return (
    <div className="border border-border/20 bg-card/20 rounded-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-body text-[10px] tracking-[0.25em] text-muted-foreground uppercase">{title}</h3>
        {onEdit && (
          <button onClick={onEdit} className="flex items-center gap-1.5 font-body text-[10px] tracking-wider text-muted-foreground hover:text-accent transition-colors">
            <Pencil size={10} /> Edit
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/10 last:border-0">
      <span className="font-body text-xs text-muted-foreground">{label}</span>
      <span className="font-body text-xs text-foreground text-right">{value || '—'}</span>
    </div>
  );
}

export default function Step4Review({ reservation, menuTotal, onNext, onBack, goTo }) {
  const [agreed, setAgreed] = useState(false);
  const [showError, setShowError] = useState(false);

  const { date, time, guests, occasion, name, email, phone, requests, guestSetup, menuSelections } = reservation;

  const displayDate = date
    ? new Date(date + 'T00:00').toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

  const SERVICE_CHARGE = menuTotal > 0 ? menuTotal * 0.05 : 0;
  const total = menuTotal + SERVICE_CHARGE;

  function handleNext() {
    if (!agreed) {
      setShowError(true);
      return;
    }
    onNext();
  }

  function handleCheck() {
    setAgreed(prev => !prev);
    if (showError) setShowError(false);
  }

  return (
    <div className="space-y-6 pb-24 xl:pb-0">
      <div>
        <h2 className="font-display text-2xl md:text-3xl tracking-wide text-foreground mb-1">Review Your Reservation</h2>
        <p className="font-body text-sm text-muted-foreground">Confirm every detail before proceeding to payment</p>
      </div>

      {/* Reservation details */}
      <Section title="Reservation Details" onEdit={() => goTo(1)}>
        <Row label="Date" value={displayDate} />
        <Row label="Time" value={time} />
        <Row label="Guests" value={`${guests} ${guests === 1 ? 'guest' : 'guests'}`} />
        <Row label="Occasion" value={occasion} />
        <Row label="Special Requests" value={requests} />
      </Section>

      {/* Contact */}
      <Section title="Contact Information" onEdit={() => goTo(1)}>
        <Row label="Name" value={name} />
        <Row label="Email" value={email} />
        <Row label="Phone" value={phone} />
      </Section>

      {/* Guests */}
      {guestSetup && guestSetup.length > 0 && (
        <Section title="Guest Details" onEdit={() => goTo(2)}>
          <div className="space-y-3">
            {guestSetup.map((guest, i) => {
              const items = menuSelections?.[i] || [];
              const subtotal = items.reduce((s, it) => s + it.price, 0);
              return (
                <div key={i} className="border border-border/15 rounded-sm p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-display text-sm text-foreground">{guest.name || `Guest ${i + 1}`}</p>
                      {guest.dietary?.length > 0 && (
                        <p className="font-body text-[10px] text-muted-foreground italic">{guest.dietary.join(', ')}</p>
                      )}
                    </div>
                    {subtotal > 0 && <span className="font-body text-xs text-accent">${subtotal.toFixed(2)}</span>}
                  </div>
                  {items.length > 0 && (
                    <div className="space-y-1 mt-2 pt-2 border-t border-border/10">
                      {sortMenuItemsAlphabetically(items).map(item => (
                        <div key={item.uid} className="flex justify-between">
                          <span className="font-body text-[11px] text-muted-foreground">{item.name}</span>
                          <span className="font-body text-[11px] text-muted-foreground">${item.price.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {items.length === 0 && (
                    <p className="font-body text-[10px] text-muted-foreground/60 italic mt-1">Ordering at the table</p>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Pricing */}
      {menuTotal > 0 && (
        <Section title="Pricing Summary" onEdit={() => goTo(3)}>
          <Row label="Menu Subtotal" value={`$${menuTotal.toFixed(2)}`} />
          {SERVICE_CHARGE > 0 && <Row label="Service Charge (5%)" value={`$${SERVICE_CHARGE.toFixed(2)}`} />}
          <div className="flex items-center justify-between pt-3 mt-1">
            <span className="font-display text-sm text-foreground tracking-wider">Total</span>
            <span className="font-display text-xl text-accent">${total.toFixed(2)}</span>
          </div>
        </Section>
      )}

      {menuTotal === 0 && (
        <div className="border border-border/15 rounded-sm p-5 text-center">
          <p className="font-body text-sm text-muted-foreground italic">No menu pre-orders — guests will order at the table</p>
          <button onClick={() => goTo(3)} className="font-body text-xs tracking-wider text-accent hover:text-foreground transition-colors mt-2 underline underline-offset-4">Add menu selections</button>
        </div>
      )}

      {/* ── CANCELLATION POLICY ── */}
      <div className="border border-border/30 bg-card/30 rounded-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border/20 bg-card/40">
          <h3 className="font-display text-base tracking-wide text-foreground">Cancellation Policy</h3>
        </div>
        <div className="px-5 py-5 space-y-4">
          <ol className="space-y-3">
            {POLICY_POINTS.map((point, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-body text-[10px] text-accent/70 tracking-wider mt-0.5 flex-shrink-0 font-semibold">{i + 1}.</span>
                <p className="font-body text-xs text-muted-foreground leading-relaxed">{point}</p>
              </li>
            ))}
          </ol>

          <div className="pt-3 border-t border-border/15 space-y-2">
            <label className="flex items-start gap-3 cursor-pointer group select-none" onClick={handleCheck}>
              <div
                className={`mt-0.5 w-5 h-5 flex-shrink-0 rounded-sm border flex items-center justify-center transition-all duration-200 ${
                  agreed
                    ? 'bg-accent border-accent'
                    : showError
                    ? 'border-amber-400/70 bg-card/80'
                    : 'border-border/50 bg-card/60 group-hover:border-border/80'
                }`}
              >
                {agreed && <Check size={11} className="text-foreground" strokeWidth={3} />}
              </div>
              <span className="font-body text-xs text-foreground/80 leading-relaxed">
                I have read and agree to the Cancellation Policy.
              </span>
            </label>
            {showError && (
              <p className="font-body text-[10px] text-amber-400 ml-8">
                Please agree to the Cancellation Policy to continue.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="font-body text-xs tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors">
          ← Back
        </button>
        <button
          onClick={handleNext}
          className={`font-body text-xs tracking-[0.2em] uppercase px-8 py-3.5 font-semibold transition-all duration-300 ${
            agreed
              ? 'bg-accent text-foreground hover:bg-accent/90 cursor-pointer shadow-[0_0_24px_rgba(160,120,60,0.2)]'
              : 'bg-muted/60 text-muted-foreground cursor-not-allowed opacity-50'
          }`}
        >
          Confirm &amp; Proceed to Payment →
        </button>
      </div>
    </div>
  );
}
