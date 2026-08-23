import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { Instagram, Wifi, X as XIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import { ASSETS } from '@/assets/index.js';

// Served from Verdura's canonical GCS public-media bucket (see README §4.3 /
// decisions-log DL-103) instead of a local Asset/ import.
const introVideo = "https://storage.googleapis.com/verdura-media-public-d3794338b2/website/hero/intro.mp4";

const MENU_IMG = ASSETS.home.menu;
const RESERVATION_IMG = ASSETS.home.reservation;
const ABOUT_IMG = ASSETS.home.about;

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] min-h-screen">
        {/* Hero */}
        <div className="relative min-h-[80vh] lg:min-h-screen">
          <video
            src={introVideo}
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover" />

          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <div className="absolute bottom-12 left-8 md:left-12">
            <h2 className="font-display text-5xl sm:text-6xl md:text-7xl lg:text-8xl text-foreground leading-[1.0] tracking-tight">
              Where Ancient Spice<br />
              Meets Modern Fire
            </h2>
            <h3 className="font-body text-base sm:text-lg md:text-xl lg:text-2xl text-foreground/70 leading-relaxed tracking-wide">
              Born from tradition, seasoned with passion, served with pride.
            </h3>
          </div>
          <div className="absolute bottom-12 right-8 flex gap-4">
            <Wifi size={18} className="text-foreground/60" />
            <Instagram size={18} className="text-foreground/60" />
            <XIcon size={18} className="text-foreground/60" />
          </div>
        </div>

        {/* Right sidebar cards */}
        <div className="hidden lg:grid grid-rows-3 gap-0">
          <Link to="/menu" className="group relative overflow-hidden">
            <img src={MENU_IMG} alt="Menu" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs tracking-[0.2em] text-foreground font-body">
              MENU <ArrowRight size={14} />
            </div>
          </Link>
          <Link to="/book" className="group relative overflow-hidden">
            <img src={RESERVATION_IMG} alt="Reservation" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs tracking-[0.2em] text-foreground font-body">
              RESERVATION <ArrowRight size={14} />
            </div>
          </Link>
          <Link to="/about" className="group relative overflow-hidden">
            <img src={ABOUT_IMG} alt="Our Story" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs tracking-[0.2em] text-foreground font-body">
              OUR STORY <ArrowRight size={14} />
            </div>
          </Link>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden grid grid-cols-1 sm:grid-cols-3 gap-px bg-border/20">
        {[
          { to: '/menu', img: MENU_IMG, label: 'MENU' },
          { to: '/book', img: RESERVATION_IMG, label: 'RESERVATION' },
          { to: '/about', img: ABOUT_IMG, label: 'OUR STORY' }].
          map((c) =>
            <Link key={c.to} to={c.to} className="relative h-48 group overflow-hidden">
              <img src={c.img} alt={c.label} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
              <div className="absolute inset-0 bg-black/40" />
              <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs tracking-[0.2em] text-foreground font-body">
                {c.label} <ArrowRight size={14} />
              </div>
            </Link>
          )}
      </div>
      <Footer />
    </div>);

}