import { useEffect, useCallback, useState } from 'react';
import { X, Flame, Leaf, Wheat } from 'lucide-react';

const BADGE_CONFIG = {
  V:    { icon: Leaf, label: 'Vegetarian' },
  VG:   { icon: Leaf, label: 'Vegan' },
  GF:   { icon: Wheat, label: 'Gluten-Free' },
  'GF+':{ icon: Wheat, label: 'Gluten-Free on request' },
  DF:   { icon: Leaf, label: 'Dairy-Free' },
  'DF+':{ icon: Leaf, label: 'Dairy-Free on request' },
};

export default function DishModal({ item, onClose, isKiosk = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const handleKey = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!item) return;
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [item, handleKey]);

  // A new item may reuse the same failed load state otherwise — reset
  // whenever the displayed dish changes (including modal close/reopen).
  useEffect(() => {
    setImageFailed(false);
  }, [item?.id]);

  if (!item) return null;

  const dietaryTags = item.tags || [];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end md:items-center justify-center"
      style={{ animation: 'modalFadeIn 0.3s ease-out forwards' }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div
        className={`relative z-10 bg-[#0a0a0a] border border-border/30 w-full md:max-w-5xl md:max-h-[90vh] h-[95vh] md:h-auto md:rounded-sm overflow-hidden flex flex-col md:flex-row${isKiosk ? ' kiosk-modal-panel' : ''}`}
        style={{ animation: 'modalSlideUp 0.4s cubic-bezier(0.16,1,0.3,1) forwards' }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 w-9 h-9 flex items-center justify-center border border-border/40 bg-black/60 backdrop-blur-sm text-muted-foreground hover:text-foreground transition-colors rounded-sm"
        >
          <X size={16} />
        </button>

        {/* Hero image — left on desktop, top on mobile */}
        <div className={`relative w-full md:w-[45%] h-56 md:h-auto flex-shrink-0 overflow-hidden${isKiosk ? ' kiosk-modal-image' : ''}`}>
          {item.image_url && !imageFailed ? (
            <img
              src={item.image_url}
              alt={item.name}
              onError={() => setImageFailed(true)}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ animation: 'imageReveal 0.6s ease-out 0.1s both' }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-card text-muted-foreground font-body text-xs tracking-[0.18em] uppercase">
              Image unavailable
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:to-[#0a0a0a]/40" />

          {/* Price badge on image */}
          <div className="absolute bottom-4 left-4 md:bottom-6 md:left-6">
            <span className="font-body text-2xl md:text-3xl text-foreground tracking-widest" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.8)' }}>
              ${item.price}
            </span>
          </div>
        </div>

        {/* Content — right on desktop, below image on mobile */}
        <div
          className={`flex-1 overflow-y-auto px-6 md:px-10 py-6 md:py-10 flex flex-col gap-6${isKiosk ? ' kiosk-modal-content' : ''}`}
          style={{ animation: 'contentSlide 0.5s ease-out 0.2s both' }}
        >
          {/* Title + badges */}
          <div>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              {dietaryTags.map(badge => {
                const cfg = BADGE_CONFIG[badge];
                if (!cfg) return null;
                const Icon = cfg.icon;
                return (
                  <span key={badge} className="flex items-center gap-1.5 text-[10px] tracking-[0.18em] text-muted-foreground border border-border/40 px-2.5 py-1 font-body uppercase">
                    <Icon size={10} />
                    {cfg.label}
                  </span>
                );
              })}
              {item.is_spicy && (
                <span className="flex items-center gap-1.5 text-[10px] tracking-[0.18em] text-accent border border-accent/30 px-2.5 py-1 font-body uppercase">
                  <Flame size={10} /> Spicy
                </span>
              )}
            </div>
            <h2 className="font-display text-3xl md:text-4xl text-foreground tracking-wide leading-tight mb-4">
              {item.name}
            </h2>
            <div className="h-px w-12 bg-accent/60 mb-4" />
            {item.description && (
              <p className="font-body text-sm text-muted-foreground leading-relaxed">
                {item.description}
              </p>
            )}
          </div>

          {/* Ingredients */}
          <div>
            <h3 className="font-body text-[10px] tracking-[0.25em] text-accent uppercase mb-3">Ingredients</h3>
            <div className="flex items-start gap-2.5">
              <div className="w-px h-3 bg-accent/50 flex-shrink-0 mt-1" />
              <span className="font-body text-xs text-muted-foreground">
                {item.description || 'Ingredient details are not provided in the final menu.'}
              </span>
            </div>
          </div>

          {/* Nutritional info */}
          <div className="border border-border/20 rounded-sm p-4">
            <h3 className="font-body text-[10px] tracking-[0.25em] text-accent uppercase mb-3">Nutritional Info</h3>
            <div className="font-body text-xs text-muted-foreground leading-relaxed">
              Nutrition unavailable — recipe quantities and serving weights are not provided in the final menu.
            </div>
          </div>

          {/* CTA Buttons */}
          <div className={`flex flex-col sm:flex-row gap-3 mt-auto pt-2${isKiosk ? ' kiosk-modal-actions' : ''}`}>
            <a
              href="https://www.ordermeal.co.nz/verdura-dunedin/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center bg-foreground text-background font-body text-xs tracking-[0.2em] uppercase py-4 px-6 hover:bg-accent hover:text-foreground transition-colors"
            >
              Order Online
            </a>
            <a
              href="/book"
              className="flex-1 text-center border border-border/50 text-foreground font-body text-xs tracking-[0.2em] uppercase py-4 px-6 hover:border-foreground transition-colors"
            >
              Reserve a Table
            </a>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes modalSlideUp {
          from { opacity: 0; transform: translateY(40px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes imageReveal {
          from { transform: scale(1.06); opacity: 0.6; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes contentSlide {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
