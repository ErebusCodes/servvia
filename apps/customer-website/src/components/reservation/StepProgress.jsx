import { Check } from 'lucide-react';

const STEPS = [
  { n: 1, label: 'Details' },
  { n: 2, label: 'Guests' },
  { n: 3, label: 'Menu' },
  { n: 4, label: 'Review' },
  { n: 5, label: 'Payment' },
];

export default function StepProgress({ step }) {
  return (
    <div className="py-6 mb-8">
      <div className="flex items-center justify-between relative">
        {/* connector line */}
        <div className="absolute top-4 left-0 right-0 h-px bg-border/30 z-0" />
        <div
          className="absolute top-4 left-0 h-px bg-accent z-0 transition-all duration-500"
          style={{ width: `${((step - 1) / 4) * 100}%` }}
        />
        {STEPS.map(s => {
          const done = step > s.n;
          const active = step === s.n;
          return (
            <div key={s.n} className="flex flex-col items-center gap-2 z-10">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300 ${
                done ? 'bg-accent border-accent' :
                active ? 'bg-background border-accent shadow-[0_0_12px_rgba(168,120,50,0.4)]' :
                'bg-background border-border/40'
              }`}>
                {done
                  ? <Check size={14} className="text-foreground" />
                  : <span className={`font-body text-xs ${active ? 'text-accent' : 'text-muted-foreground'}`}>{s.n}</span>
                }
              </div>
              <span className={`font-body text-[10px] tracking-[0.15em] uppercase hidden sm:block transition-colors ${
                active ? 'text-foreground' : done ? 'text-accent' : 'text-muted-foreground'
              }`}>{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}