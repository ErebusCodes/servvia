import { useState } from 'react';
import { X } from 'lucide-react';

export default function CancelBar({ onCancel }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-4">
        <span className="font-body text-xs text-muted-foreground">Are you sure? Your selections will be lost.</span>
        <button
          onClick={() => { setConfirming(false); onCancel(); }}
          className="font-body text-xs tracking-wider text-destructive hover:text-destructive/80 transition-colors border border-destructive/30 px-3 py-1.5 rounded-sm hover:border-destructive/60"
        >
          Yes, cancel
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="font-body text-xs tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          Keep going
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1.5 font-body text-xs tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors"
    >
      <X size={11} /> Cancel &amp; Start Over
    </button>
  );
}