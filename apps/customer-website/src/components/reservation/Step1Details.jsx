import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Minus, Loader2, AlertTriangle } from 'lucide-react';
import { checkAvailability } from '../../api/reservations';

const OCCASIONS = ['Casual Dining', 'Birthday', 'Anniversary', 'Business Dinner', 'Private Event', 'Date Night', 'Family Gathering'];
const LUNCH_SLOTS = ['12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM'];
const DINNER_SLOTS = ['5:00 PM', '5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM', '8:30 PM', '9:00 PM', '9:30 PM'];

function formatDateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function displayDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function Calendar({ value, onChange }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [view, setView] = useState(() => {
    if (value) { const [y, m] = value.split('-').map(Number); return { year: y, month: m - 1 }; }
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const { year, month } = view;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array(firstDay).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));
  const prevMonth = () => setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 });
  const nextMonth = () => setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 });
  const monthName = new Date(year, month).toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' });

  return (
    <div className="border border-border/25 bg-card/40 rounded-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-1 text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft size={16} /></button>
        <span className="font-display text-sm tracking-wider text-foreground">{monthName}</span>
        <button onClick={nextMonth} className="p-1 text-muted-foreground hover:text-foreground transition-colors"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-2">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className="text-center font-body text-[9px] tracking-widest text-muted-foreground py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = formatDateStr(year, month, day);
          const isPast = new Date(year, month, day) < today;
          const isSelected = value === dateStr;
          return (
            <button key={i} disabled={isPast} onClick={() => onChange(dateStr)}
              className={`h-8 w-full rounded-sm font-body text-xs transition-all ${
                isSelected ? 'bg-accent text-foreground' :
                isPast ? 'text-muted-foreground/30 cursor-not-allowed' :
                'text-foreground hover:bg-card hover:text-accent'
              }`}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Reusable styled input
function TextInput({ value, onChange, type = 'text', placeholder, hasError }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={onChange}
      placeholder={placeholder}
      className={`w-full bg-card/50 border ${hasError ? 'border-destructive/60 focus:border-destructive/80' : 'border-border/30 focus:border-accent/60'} rounded-sm px-4 py-3 font-body text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-0 transition-colors`}
    />
  );
}

function FieldLabel({ label, required }) {
  return (
    <label className="font-body text-[10px] tracking-[0.2em] text-muted-foreground uppercase flex items-center gap-1.5">
      {label}
      {!required && <span className="text-muted-foreground/50 normal-case tracking-normal text-[10px]">(Optional)</span>}
    </label>
  );
}

export default function Step1Details({ reservation, update, onNext }) {
  const [errors, setErrors] = useState({});
  const [availability, setAvailability] = useState(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');

  // Real, database-backed availability — checked whenever date/time/party
  // size are all chosen. Never fabricated; a failed check shows an honest
  // error rather than silently letting the guest proceed.
  useEffect(() => {
    const { date, time, guests } = reservation;
    if (!date || !time || !guests) {
      setAvailability(null);
      setAvailabilityError('');
      return;
    }
    let cancelled = false;
    setCheckingAvailability(true);
    setAvailabilityError('');
    checkAvailability({ date, time, partySize: guests })
      .then(result => { if (!cancelled) setAvailability(result); })
      .catch(err => { if (!cancelled) setAvailabilityError(err?.message || 'Could not check availability.'); })
      .finally(() => { if (!cancelled) setCheckingAvailability(false); });
    return () => { cancelled = true; };
  }, [reservation.date, reservation.time, reservation.guests]);

  function clearError(field) {
    if (errors[field]) setErrors(p => ({ ...p, [field]: '' }));
  }

  function validate() {
    const e = {};
    if (!reservation.date) e.date = 'Please select a date';
    if (!reservation.time) e.time = 'Please select a time slot';
    if (availability && !availability.available) e.time = 'This time is fully booked — please choose another';
    if (!reservation.name?.trim()) e.name = 'Full name is required';
    if (!reservation.email?.trim()) {
      e.email = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reservation.email)) {
      e.email = 'Please enter a valid email address';
    }
    if (!reservation.phone?.trim()) {
      e.phone = 'Phone number is required';
    } else if (reservation.phone.replace(/[\s\-+()]/g, '').length < 7) {
      e.phone = 'Please enter a valid phone number';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) {
      // scroll to first error
      const firstKey = Object.keys(e)[0];
      document.getElementById(`field-${firstKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return Object.keys(e).length === 0;
  }

  function handleNext() {
    if (!validate()) return;
    const count = reservation.guests || 2;
    const existing = reservation.guestSetup || [];
    const guestSetup = Array.from({ length: count }, (_, i) => existing[i] || { id: i, name: '', dietary: [] });
    update({ guestSetup });
    onNext();
  }

  return (
    <div className="space-y-10 pb-8">
      <div>
        <h2 className="font-display text-2xl md:text-3xl tracking-wide text-foreground mb-1">Reservation Details</h2>
        <p className="font-body text-sm text-muted-foreground">Step 1 of 5 — Let's start with the basics</p>
      </div>

      {/* ── DATE & TIME ── */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border/15" />
          <span className="font-body text-[9px] tracking-[0.3em] text-muted-foreground uppercase">Date &amp; Time</span>
          <div className="h-px flex-1 bg-border/15" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Date picker */}
          <div id="field-date" className="space-y-2">
            <FieldLabel label="Select Date" required />
            <Calendar
              value={reservation.date}
              onChange={d => { update({ date: d }); clearError('date'); }}
            />
            {reservation.date
              ? <p className="font-body text-xs text-accent">{displayDate(reservation.date)}</p>
              : errors.date && <p className="font-body text-[10px] text-destructive">{errors.date}</p>
            }
          </div>

          {/* Time slots */}
          <div id="field-time" className="space-y-4">
            <FieldLabel label="Select Time" required />
            <div className="space-y-3">
              <p className="font-body text-[9px] tracking-[0.2em] text-muted-foreground/70 uppercase">Lunch Service</p>
              <div className="flex flex-wrap gap-2">
                {LUNCH_SLOTS.map(t => (
                  <button key={t} onClick={() => { update({ time: t }); clearError('time'); }}
                    className={`px-3 py-1.5 border rounded-sm font-body text-xs tracking-wider transition-all ${reservation.time === t ? 'bg-accent/20 border-accent text-foreground' : 'border-border/25 text-muted-foreground hover:border-border/50 hover:text-foreground'}`}>
                    {t}
                  </button>
                ))}
              </div>
              <p className="font-body text-[9px] tracking-[0.2em] text-muted-foreground/70 uppercase mt-1">Dinner Service</p>
              <div className="flex flex-wrap gap-2">
                {DINNER_SLOTS.map(t => (
                  <button key={t} onClick={() => { update({ time: t }); clearError('time'); }}
                    className={`px-3 py-1.5 border rounded-sm font-body text-xs tracking-wider transition-all ${reservation.time === t ? 'bg-accent/20 border-accent text-foreground' : 'border-border/25 text-muted-foreground hover:border-border/50 hover:text-foreground'}`}>
                    {t}
                  </button>
                ))}
              </div>
              {errors.time && <p className="font-body text-[10px] text-destructive">{errors.time}</p>}
            </div>

            {/* Guests inline */}
            <div className="pt-2 space-y-2">
              <FieldLabel label="Number of Guests" required />
              <div className="flex items-center gap-4">
                <button onClick={() => update({ guests: Math.max(1, (reservation.guests || 2) - 1) })}
                  className="w-9 h-9 border border-border/30 rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border/60 transition-all">
                  <Minus size={13} />
                </button>
                <span className="font-display text-2xl text-foreground w-10 text-center tabular-nums">{reservation.guests || 2}</span>
                <button onClick={() => update({ guests: Math.min(100, (reservation.guests || 2) + 1) })}
                  className="w-9 h-9 border border-border/30 rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border/60 transition-all">
                  <Plus size={13} />
                </button>
                <span className="font-body text-xs text-muted-foreground">{reservation.guests === 1 ? 'guest' : 'guests'}</span>
              </div>
              {checkingAvailability && (
                <p className="font-body text-[10px] text-muted-foreground flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin" /> Checking availability…
                </p>
              )}
              {!checkingAvailability && availabilityError && (
                <p className="font-body text-[10px] text-destructive flex items-center gap-1.5">
                  <AlertTriangle size={11} /> {availabilityError}
                </p>
              )}
              {!checkingAvailability && !availabilityError && availability && (
                availability.available ? (
                  <p className="font-body text-[10px] text-accent">This time slot is available.</p>
                ) : (
                  <p className="font-body text-[10px] text-destructive flex items-center gap-1.5">
                    <AlertTriangle size={11} /> This time is fully booked — please choose another time or date.
                  </p>
                )
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── OCCASION ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border/15" />
          <span className="font-body text-[9px] tracking-[0.3em] text-muted-foreground uppercase">Occasion</span>
          <div className="h-px flex-1 bg-border/15" />
        </div>
        <FieldLabel label="What's the occasion?" />
        <div className="flex flex-wrap gap-2">
          {OCCASIONS.map(o => (
            <button key={o} onClick={() => update({ occasion: reservation.occasion === o ? '' : o })}
              className={`px-3 py-1.5 border rounded-sm font-body text-xs tracking-wider transition-all ${reservation.occasion === o ? 'bg-accent/20 border-accent text-foreground' : 'border-border/25 text-muted-foreground hover:border-border/50 hover:text-foreground'}`}>
              {o}
            </button>
          ))}
        </div>
      </section>

      {/* ── CONTACT DETAILS ── */}
      <section className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border/15" />
          <span className="font-body text-[9px] tracking-[0.3em] text-muted-foreground uppercase">Contact Details</span>
          <div className="h-px flex-1 bg-border/15" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Full Name */}
          <div id="field-name" className="space-y-2">
            <FieldLabel label="Full Name" required />
            <TextInput
              value={reservation.name}
              onChange={e => { update({ name: e.target.value }); clearError('name'); }}
              placeholder="Your full name"
              hasError={!!errors.name}
            />
            {errors.name && <p className="font-body text-[10px] text-destructive">{errors.name}</p>}
          </div>

          {/* Email */}
          <div id="field-email" className="space-y-2">
            <FieldLabel label="Email Address" required />
            <TextInput
              value={reservation.email}
              onChange={e => { update({ email: e.target.value }); clearError('email'); }}
              type="email"
              placeholder="your@email.com"
              hasError={!!errors.email}
            />
            {errors.email && <p className="font-body text-[10px] text-destructive">{errors.email}</p>}
          </div>

          {/* Phone */}
          <div id="field-phone" className="space-y-2">
            <FieldLabel label="Phone Number" required />
            <TextInput
              value={reservation.phone}
              onChange={e => { update({ phone: e.target.value }); clearError('phone'); }}
              type="tel"
              placeholder="e.g. +64 21 000 0000"
              hasError={!!errors.phone}
            />
            {errors.phone && <p className="font-body text-[10px] text-destructive">{errors.phone}</p>}
          </div>
        </div>

        {/* Special Requests — full width */}
        <div className="space-y-2">
          <FieldLabel label="Special Requests" />
          <textarea
            value={reservation.requests || ''}
            onChange={e => update({ requests: e.target.value })}
            placeholder="Any dietary requirements, allergies, special occasions, or requests..."
            rows={3}
            className="w-full bg-card/50 border border-border/30 rounded-sm px-4 py-3 font-body text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-accent/60 transition-colors resize-none"
          />
        </div>
      </section>

      {/* CTA */}
      <div className="flex justify-end pt-2">
        <button onClick={handleNext}
          className="font-body text-xs tracking-[0.2em] uppercase bg-foreground text-background px-8 py-3.5 hover:bg-foreground/90 transition-colors">
          Continue to Guest Setup →
        </button>
      </div>
    </div>
  );
}