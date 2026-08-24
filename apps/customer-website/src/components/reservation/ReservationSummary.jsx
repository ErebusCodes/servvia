import { CalendarDays, Clock, Users, ChevronRight } from 'lucide-react';

export default function ReservationSummary({ reservation, menuTotal, step, goTo, mobile = false }) {
  const { date, time, guests, occasion, name } = reservation;

  if (mobile) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {date && <span className="font-body text-xs text-muted-foreground flex items-center gap-1"><CalendarDays size={11} />{date}</span>}
          {time && <span className="font-body text-xs text-muted-foreground flex items-center gap-1"><Clock size={11} />{time}</span>}
          {guests && <span className="font-body text-xs text-muted-foreground flex items-center gap-1"><Users size={11} />{guests}</span>}
        </div>
        {menuTotal > 0 && (
          <span className="font-display text-sm text-accent tracking-wider flex-shrink-0">${menuTotal.toFixed(2)}</span>
        )}
      </div>
    );
  }

  return (
    <div className="border border-border/25 bg-card/40 rounded-sm p-5 space-y-4">
      <h3 className="font-display text-base tracking-[0.15em] text-foreground uppercase">Your Reservation</h3>
      <div className="h-px bg-border/20" />

      <div className="space-y-3">
        {name && (
          <Row label="Guest" value={name} />
        )}
        {date && (
          <Row label="Date" value={date} icon={<CalendarDays size={11} className="text-accent" />} />
        )}
        {time && (
          <Row label="Time" value={time} icon={<Clock size={11} className="text-accent" />} />
        )}
        {guests && (
          <Row label="Guests" value={`${guests} ${guests === 1 ? 'guest' : 'guests'}`} icon={<Users size={11} className="text-accent" />} />
        )}
        {occasion && (
          <Row label="Occasion" value={occasion} />
        )}
      </div>

      {menuTotal > 0 && (
        <>
          <div className="h-px bg-border/20" />
          <div className="flex items-center justify-between">
            <span className="font-body text-xs text-muted-foreground tracking-wider uppercase">Menu Total</span>
            <span className="font-display text-base text-accent tracking-wider">${menuTotal.toFixed(2)}</span>
          </div>
        </>
      )}

      {step > 1 && (
        <>
          <div className="h-px bg-border/20" />
          <div className="space-y-1.5">
            {[
              { n: 1, label: 'Details' },
              { n: 2, label: 'Guests' },
              { n: 3, label: 'Menu' },
            ].filter(s => s.n < step).map(s => (
              <button
                key={s.n}
                onClick={() => goTo(s.n)}
                className="flex items-center justify-between w-full text-left group py-1"
              >
                <span className="font-body text-[10px] tracking-[0.15em] text-muted-foreground uppercase group-hover:text-foreground transition-colors">Edit {s.label}</span>
                <ChevronRight size={10} className="text-muted-foreground group-hover:text-accent transition-colors" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, icon = null }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="font-body text-[10px] tracking-[0.15em] text-muted-foreground uppercase flex items-center gap-1">{icon}{label}</span>
      <span className="font-body text-xs text-foreground text-right">{value}</span>
    </div>
  );
}