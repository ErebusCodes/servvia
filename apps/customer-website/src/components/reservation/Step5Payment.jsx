import { useState } from 'react';
import { Building2, UtensilsCrossed, CalendarPlus, Share2, Mail, Check, Loader2, Tag } from 'lucide-react';

// Card / Apple Pay / Google Pay are intentionally not offered here: per
// docs/decisions-log.md DL-048, online card payment is deferred for MVP —
// only bank transfer or pay-at-restaurant (manual staff confirmation) are
// real, supported payment methods for reservations.
const PAYMENT_METHODS = [
  { id: 'pay_at_restaurant', label: 'Pay at Restaurant', icon: UtensilsCrossed },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: Building2 },
];

function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="font-body text-xs text-muted-foreground">{label}</span>
      {value && <span className="font-body text-xs text-foreground text-right">{value}</span>}
    </div>
  );
}

function ConfirmationScreen({ bookingRef, reservation, menuTotal }) {
  const [emailSent, setEmailSent] = useState(false);
  const SERVICE_CHARGE = menuTotal > 0 ? menuTotal * 0.05 : 0;
  const total = menuTotal + SERVICE_CHARGE;
  const displayDate = reservation.date ? new Date(reservation.date + 'T00:00').toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';

  return (
    <div className="min-h-screen flex items-center justify-center py-16 px-4">
      <div className="max-w-lg w-full text-center space-y-8" style={{ animation: 'confirmFade 0.6s ease-out' }}>
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center shadow-[0_0_40px_rgba(168,120,50,0.2)]">
            <Check size={32} className="text-accent" />
          </div>
        </div>

        <div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground tracking-wide mb-2">Reservation Confirmed</h1>
          <p className="font-body text-sm text-muted-foreground">Thank you, {reservation.name}. We look forward to welcoming you.</p>
        </div>

        <div className="border border-accent/25 bg-accent/5 rounded-sm py-4 px-6 inline-block">
          <p className="font-body text-[9px] tracking-[0.3em] text-muted-foreground uppercase mb-1">Booking Reference</p>
          <p className="font-display text-2xl text-accent tracking-widest">{bookingRef}</p>
        </div>

        <div className="border border-border/20 bg-card/30 rounded-sm p-6 text-left space-y-2">
          <p className="font-body text-[9px] tracking-[0.25em] text-muted-foreground uppercase mb-3">Reservation Summary</p>
          {displayDate && <SummaryRow label="Date" value={displayDate} />}
          {reservation.time && <SummaryRow label="Time" value={reservation.time} />}
          <SummaryRow label="Guests" value={`${reservation.guests} ${reservation.guests === 1 ? 'guest' : 'guests'}`} />
          {reservation.occasion && <SummaryRow label="Occasion" value={reservation.occasion} />}
          {total > 0 && (
            <div className="flex justify-between gap-2 pt-2 border-t border-border/15 mt-2">
              <span className="font-body text-xs text-muted-foreground">Total</span>
              <span className="font-body text-xs text-accent font-semibold">${total.toFixed(2)}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: CalendarPlus, label: 'Add to Calendar', action: () => {} },
            { icon: Share2, label: 'Share Booking', action: () => {} },
            { icon: emailSent ? Check : Mail, label: emailSent ? 'Email Sent' : 'Email Confirmation', action: () => setEmailSent(true) },
          ].map(({ icon: Icon, label, action }) => (
            <button key={label} onClick={action}
              className="flex items-center justify-center gap-2 border border-border/30 text-muted-foreground hover:text-foreground hover:border-border/60 transition-all px-4 py-3 rounded-sm font-body text-xs tracking-wider">
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        <p className="font-body text-xs text-muted-foreground/60">
          A confirmation has been sent to {reservation.email}
        </p>
      </div>

      <style>{`
        @keyframes confirmFade {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default function Step5Payment({ reservation, menuTotal, bookingRef, confirmed, onConfirm, update, onBack }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);

  const SERVICE_CHARGE = menuTotal > 0 ? menuTotal * 0.05 : 0;
  const discount = promoApplied ? (menuTotal + SERVICE_CHARGE) * 0.1 : 0;
  const total = menuTotal + SERVICE_CHARGE - discount;
  const paymentMethod = reservation.paymentMethod || 'pay_at_restaurant';

  if (confirmed) {
    return <ConfirmationScreen bookingRef={bookingRef} reservation={reservation} menuTotal={menuTotal} />;
  }

  function applyPromo() {
    if (promoInput.toUpperCase() === 'VERDURA10') {
      setPromoApplied(true); setError('');
    } else {
      setError('Invalid promo code');
    }
  }

  // Submits the real reservation via onConfirm (BookTable.jsx -> the
  // backend). Only shows the confirmation screen if that call actually
  // succeeds; on failure, shows the real error and lets the guest retry —
  // never fabricates success.
  async function handlePay() {
    setError(''); setLoading(true);
    try {
      await onConfirm();
    } catch (err) {
      setError(err?.message || 'Something went wrong while submitting your reservation. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8 pb-24 xl:pb-0">
      <div>
        <h2 className="font-display text-2xl md:text-3xl tracking-wide text-foreground mb-1">Checkout</h2>
        <p className="font-body text-sm text-muted-foreground">Almost there — complete your reservation</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">
        <div className="space-y-6">
          {/* Method selector */}
          <div className="space-y-2">
            <p className="font-body text-[10px] tracking-[0.2em] text-muted-foreground uppercase">Payment Method</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PAYMENT_METHODS.map(m => {
                const Icon = m.icon;
                return (
                  <button key={m.id} onClick={() => update({ paymentMethod: m.id })}
                    className={`flex flex-col items-center gap-2 p-4 border rounded-sm transition-all ${paymentMethod === m.id ? 'border-accent/50 bg-accent/10 text-foreground' : 'border-border/25 text-muted-foreground hover:border-border/50 hover:text-foreground'}`}>
                    <Icon size={18} />
                    <span className="font-body text-[10px] tracking-wider text-center leading-tight">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {paymentMethod === 'pay_at_restaurant' && (
            <div className="border border-border/20 rounded-sm p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-foreground/10 flex items-center justify-center mx-auto mb-3">
                <UtensilsCrossed size={22} className="text-foreground" />
              </div>
              <p className="font-display text-base text-foreground mb-1">Pay at Restaurant</p>
              <p className="font-body text-xs text-muted-foreground">Settle your bill in person when you dine with us — no payment is taken now.</p>
            </div>
          )}

          {paymentMethod === 'bank_transfer' && (
            <div className="border border-border/20 bg-card/20 rounded-sm p-5 space-y-3">
              <p className="font-body text-[9px] tracking-[0.25em] text-muted-foreground uppercase">Bank Transfer Details</p>
              <div className="space-y-2">
                <SummaryRow label="Bank" value="ANZ New Zealand" />
                <SummaryRow label="Account Name" value="Verdura Restaurant Ltd" />
                <SummaryRow label="Account Number" value="06-0123-0456789-00" />
                <SummaryRow label="Reference" value="Your booking ref (provided after confirming)" />
              </div>
              <p className="font-body text-[10px] text-muted-foreground italic">Payment must be received within 24 hours to secure your reservation.</p>
            </div>
          )}

          {/* Promo */}
          <div className="space-y-2">
            <p className="font-body text-[10px] tracking-[0.2em] text-muted-foreground uppercase">Promo / Voucher Code</p>
            <div className="flex gap-2">
              <input value={promoInput} onChange={e => setPromoInput(e.target.value.toUpperCase())} placeholder="Enter code"
                className="flex-1 bg-card/40 border border-border/30 rounded-sm px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent/60 transition-colors tracking-wider" />
              <button onClick={applyPromo} disabled={promoApplied}
                className={`flex items-center gap-2 px-4 py-2.5 border rounded-sm font-body text-xs tracking-wider transition-all ${promoApplied ? 'border-accent/40 text-accent' : 'border-border/30 text-muted-foreground hover:border-border/60 hover:text-foreground'}`}>
                {promoApplied ? <><Check size={12} /> Applied</> : <><Tag size={12} /> Apply</>}
              </button>
            </div>
            {promoApplied && <p className="font-body text-[10px] text-accent">10% discount applied! (Code: VERDURA10)</p>}
          </div>

          {error && (
            <div className="border border-destructive/30 bg-destructive/5 rounded-sm px-4 py-3">
              <p className="font-body text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>

        {/* Order summary */}
        <div className="border border-border/25 bg-card/30 rounded-sm p-5 space-y-4 lg:sticky lg:top-24">
          <p className="font-body text-[10px] tracking-[0.25em] text-muted-foreground uppercase">Order Summary</p>
          <div className="h-px bg-border/20" />
          <SummaryRow label={`${reservation.guests} guest${reservation.guests !== 1 ? 's' : ''}`} value="" />
          {reservation.date && <SummaryRow label={new Date(reservation.date + 'T00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} value={reservation.time || ''} />}
          {reservation.occasion && <SummaryRow label={reservation.occasion} value="" />}
          <div className="h-px bg-border/10" />
          {menuTotal > 0 && <SummaryRow label="Menu Subtotal" value={`$${menuTotal.toFixed(2)}`} />}
          {SERVICE_CHARGE > 0 && <SummaryRow label="Service Charge (5%)" value={`$${SERVICE_CHARGE.toFixed(2)}`} />}
          {discount > 0 && <SummaryRow label="Promo Discount" value={`-$${discount.toFixed(2)}`} />}
          <div className="h-px bg-border/20" />
          <div className="flex items-center justify-between">
            <span className="font-display text-sm text-foreground">Total</span>
            <span className="font-display text-2xl text-accent">{menuTotal > 0 ? `$${total.toFixed(2)}` : 'No pre-order'}</span>
          </div>

          <button onClick={handlePay} disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-accent text-foreground py-4 font-body text-xs tracking-[0.25em] uppercase hover:bg-accent/90 transition-all disabled:opacity-70">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Processing...</> : 'Complete Reservation'}
          </button>
        </div>
      </div>

      <div className="flex justify-start pt-2">
        <button onClick={onBack} className="font-body text-xs tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors">← Back to Review</button>
      </div>
    </div>
  );
}