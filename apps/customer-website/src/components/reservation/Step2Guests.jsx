import { useState } from 'react';
import { User, Copy, Check } from 'lucide-react';

const DIETARY = ['None', 'Vegetarian', 'Vegan', 'Gluten-Free', 'Halal', 'Nut Allergy', 'Dairy-Free', 'Shellfish Allergy'];

function GuestCard({ guest, index, onChange, onDuplicate, guestCount }) {
  const [copied, setCopied] = useState(false);

  function toggleDietary(opt) {
    const current = guest.dietary || [];
    if (opt === 'None') { onChange({ ...guest, dietary: [] }); return; }
    const next = current.includes(opt) ? current.filter(d => d !== opt) : [...current.filter(d => d !== 'None'), opt];
    onChange({ ...guest, dietary: next });
  }

  function handleDuplicate() {
    onDuplicate(index);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const hasPrefs = guest.dietary && guest.dietary.length > 0;

  return (
    <div className={`border rounded-sm p-5 transition-all duration-300 ${hasPrefs ? 'border-accent/30 bg-accent/5' : 'border-border/25 bg-card/30'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-sm flex items-center justify-center border transition-colors ${hasPrefs ? 'border-accent/50 bg-accent/10' : 'border-border/30 bg-card'}`}>
            <User size={15} className={hasPrefs ? 'text-accent' : 'text-muted-foreground'} />
          </div>
          <div>
            <p className="font-body text-[9px] tracking-[0.2em] text-muted-foreground uppercase">Guest {index + 1}</p>
            {guest.name && <p className="font-display text-xs text-foreground">{guest.name}</p>}
          </div>
        </div>
        {guestCount > 1 && (
          <button onClick={handleDuplicate}
            className="flex items-center gap-1.5 font-body text-[10px] tracking-wider text-muted-foreground hover:text-foreground transition-colors border border-border/20 px-2.5 py-1 rounded-sm hover:border-border/40">
            {copied ? <Check size={10} className="text-accent" /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Duplicate'}
          </button>
        )}
      </div>

      {/* Name */}
      <input
        type="text"
        value={guest.name || ''}
        onChange={e => onChange({ ...guest, name: e.target.value })}
        placeholder={`Guest ${index + 1} name (optional)`}
        className="w-full bg-background/40 border border-border/20 rounded-sm px-3 py-2 font-body text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-accent/50 transition-colors mb-3"
      />

      {/* Dietary */}
      <p className="font-body text-[9px] tracking-[0.2em] text-muted-foreground uppercase mb-2">Dietary Preferences</p>
      <div className="flex flex-wrap gap-1.5">
        {DIETARY.map(opt => {
          const active = opt === 'None' ? !guest.dietary?.length : guest.dietary?.includes(opt);
          return (
            <button key={opt} onClick={() => toggleDietary(opt)}
              className={`px-2.5 py-1 border rounded-sm font-body text-[10px] tracking-wider transition-all ${
                active ? 'bg-accent/15 border-accent/50 text-foreground' : 'border-border/20 text-muted-foreground hover:border-border/40 hover:text-foreground'
              }`}>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Step2Guests({ reservation, update, onNext, onBack }) {
  const guests = reservation.guestSetup || [];
  const guestCount = reservation.guests || 2;
  const isLargeGroup = guestCount >= 10;
  const [bulkDietary, setBulkDietary] = useState([]);
  const [bulkApplied, setBulkApplied] = useState(false);

  function updateGuest(i, data) {
    const updated = [...guests];
    updated[i] = data;
    update({ guestSetup: updated });
  }

  function duplicateGuest(fromIndex) {
    const source = guests[fromIndex];
    const updated = guests.map((g, i) => i === fromIndex ? g : { ...g, dietary: [...(source.dietary || [])] });
    update({ guestSetup: updated });
  }

  function applyBulkDietary() {
    const updated = guests.map(g => ({ ...g, dietary: [...bulkDietary] }));
    update({ guestSetup: updated });
    setBulkApplied(true);
    setTimeout(() => setBulkApplied(false), 2000);
  }

  function toggleBulk(opt) {
    if (opt === 'None') { setBulkDietary([]); return; }
    setBulkDietary(prev => prev.includes(opt) ? prev.filter(d => d !== opt) : [...prev.filter(d => d !== 'None'), opt]);
  }

  return (
    <div className="space-y-6 pb-24 xl:pb-0">
      <div>
        <h2 className="font-display text-2xl md:text-3xl tracking-wide text-foreground mb-1">Guest Setup</h2>
        <p className="font-body text-sm text-muted-foreground">{guestCount} {guestCount === 1 ? 'guest' : 'guests'} · Add names and dietary preferences</p>
      </div>

      {/* Large group bulk */}
      {isLargeGroup && (
        <div className="border border-accent/20 bg-accent/5 rounded-sm p-5">
          <p className="font-body text-xs tracking-wider text-foreground mb-3">Bulk Setup — Apply dietary preferences to all guests</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {DIETARY.map(opt => {
              const active = opt === 'None' ? !bulkDietary.length : bulkDietary.includes(opt);
              return (
                <button key={opt} onClick={() => toggleBulk(opt)}
                  className={`px-3 py-1.5 border rounded-sm font-body text-xs tracking-wider transition-all ${active ? 'bg-accent/15 border-accent/50 text-foreground' : 'border-border/25 text-muted-foreground hover:border-border/40'}`}>
                  {opt}
                </button>
              );
            })}
          </div>
          <button onClick={applyBulkDietary}
            className="flex items-center gap-2 font-body text-xs tracking-[0.15em] uppercase border border-foreground/30 text-foreground px-5 py-2 hover:bg-foreground hover:text-background transition-all">
            {bulkApplied ? <><Check size={12} /> Applied to all guests</> : 'Apply to All Guests'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 gap-4">
        {guests.map((guest, i) => (
          <GuestCard key={i} guest={guest} index={i} onChange={d => updateGuest(i, d)} onDuplicate={duplicateGuest} guestCount={guestCount} />
        ))}
      </div>

      <div className="flex items-center justify-between pt-4">
        <button onClick={onBack} className="flex items-center gap-2 font-body text-xs tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors">
          ← Back
        </button>
        <button onClick={onNext} className="font-body text-xs tracking-[0.2em] uppercase bg-foreground text-background px-8 py-3.5 hover:bg-foreground/90 transition-colors">
          Continue to Menu →
        </button>
      </div>
    </div>
  );
}