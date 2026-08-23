import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Kiosk mode check: if port is 5174, hide full header and show only a floating exit button
  if (window.location.port === '5174') {
    return (
      <Link
        to="/"
        className="fixed top-6 right-6 z-50 flex items-center justify-center w-12 h-12 bg-[#111111]/90 hover:bg-[#1c1c1e] text-white rounded-full border border-white/10 transition-all shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
        aria-label="Back to Signage"
      >
        <X size={22} />
      </Link>
    );
  }

  const links = [
    { label: 'MENU', to: '/menu' },
    { label: 'ABOUT', to: '/about' },
    { label: 'CONTACT', to: '/contact' },
  ];


  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-5 md:px-8 py-3">
      <div className="flex items-center gap-4">
        <div className="flex min-h-[48px] items-center gap-4 md:gap-8 bg-[#111111]/90 backdrop-blur-md border border-border rounded-[10px] px-4 md:px-5 py-2 shadow-[var(--shadow-button)]">
          <button onClick={() => setOpen(!open)} className="text-foreground" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link to="/" className="font-display text-lg tracking-[0.2em] text-foreground font-semibold">VERDURA

          </Link>
          {links.map((l) =>
          <Link
            key={l.to}
            to={l.to}
            className={`hidden md:block text-[15px] font-semibold tracking-normal font-body transition-colors ${
            location.pathname === l.to ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`
            }>
            
              {l.label}
            </Link>
          )}
          <Link
            to="/book"
            className={`hidden md:flex min-h-[44px] items-center text-[15px] font-semibold tracking-normal font-body px-5 rounded-[10px] transition-colors ${
              location.pathname === '/book' ? 'bg-accent text-accent-foreground' : 'bg-foreground text-background'
            }`}>
            BOOK A TABLE
          </Link>
          <a
            href="https://www.ordermeal.co.nz/verdura-dunedin/"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex min-h-[44px] items-center text-[15px] font-semibold tracking-normal font-body bg-accent text-accent-foreground px-5 rounded-[10px] hover:bg-accent/90 transition-colors">
            ORDER ONLINE
          </a>
        </div>
      </div>

      {open &&
      <div className="fixed inset-0 top-16 bg-background/95 backdrop-blur-lg z-40 flex flex-col items-center justify-center gap-8">
          {[...links, { label: 'BOOK A TABLE', to: '/book' }].map((l) =>
        <Link
          key={l.to}
          to={l.to}
          onClick={() => setOpen(false)}
          className={`font-display text-3xl tracking-wider hover:text-accent transition-colors ${
            location.pathname === l.to ? 'text-accent' : 'text-foreground'
          }`}>
              {l.label}
            </Link>
        )}
          <a
            href="https://www.ordermeal.co.nz/verdura-dunedin/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="font-display text-3xl tracking-wider text-accent hover:text-foreground transition-colors">
            ORDER ONLINE
          </a>
        </div>
      }
    </nav>);

}
