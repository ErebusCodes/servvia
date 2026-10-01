import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { MapPin } from 'lucide-react';
import { ASSETS } from '@/assets/index.js';

const HERO_IMG = ASSETS.hero.about;
const CHEF_IMG = ASSETS.about.chef;
const RESERVATION_IMG = ASSETS.about.reservation;

export default function About() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="grid grid-cols-1 lg:grid-cols-2 min-h-screen">
        {/* Left hero */}
        <div className="relative h-[50vh] lg:h-screen lg:sticky lg:top-0">
          <img src={HERO_IMG} alt="About" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <div className="absolute bottom-8 left-8 right-8">
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl text-foreground tracking-tight leading-tight italic">
              Where Smoke Carries<br />
              a Thousand Years
            </h2>
          </div>
        </div>

        {/* Right content */}
        <div className="p-6 md:p-12 space-y-8 lg:pt-28">

          {/* Opening statement */}
          <div className="border-l-2 border-accent pl-6">
            <p className="font-display text-xl md:text-2xl text-foreground leading-relaxed italic">
              "There is a place where the smoke of the char-grill carries the memory of a thousand-year-old spice road — and it lives, improbably, beautifully, in the heart of Dunedin."
            </p>
          </div>

          {/* Middleterrean concept */}
          <div className="space-y-3">
            <h2 className="font-display text-2xl md:text-3xl tracking-wider text-foreground">
              THE MIDDLETERREAN PHILOSOPHY
            </h2>
            <div className="h-px w-12 bg-accent" />
            <p className="text-muted-foreground font-body text-sm leading-loose">
              Verdura was born from a single, audacious idea: that the ancient culinary traditions of Iran, Kuwait, Turkey, Greece, Cyprus, and the Levant are not separate stories — they are chapters of the same book. We call this convergence <em className="text-foreground">Middleterrean</em>. It is neither Middle Eastern nor Mediterranean alone, but something richer, something that exists in the overlap — in the shared love of fire, of slow-cooked lamb, of citrus-dressed leaves and wood-charred bread pulled warm from the oven. At Verdura, we honour that shared inheritance with every dish we place before you.
            </p>
          </div>

          {/* Ingredients image + text */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative h-64 md:h-auto rounded-sm overflow-hidden">
              <img src={CHEF_IMG} alt="Craftsmanship at Verdura" className="absolute inset-0 w-full h-full object-cover" />
            </div>
            <div className="bg-card border border-border/20 rounded-sm p-7 flex flex-col justify-center space-y-3">
              <h3 className="font-display text-lg tracking-wider text-foreground">
                GROWN HERE.<br />INSPIRED THERE.
              </h3>
              <p className="text-muted-foreground font-body text-sm leading-loose">
                We source the finest produce New Zealand has to offer — its clean-air lamb, its pristine herbs, its honest, unhurried vegetables — and we treat them with the reverence of the old world. Signature kebabs are charred over high heat and rested with care. Mezes arrive at the table vibrant with pomegranate, sumac and tahini. Cocktails and mocktails are drawn from botanicals that echo the markets of Istanbul and the hillsides of Crete. Nothing here is hurried. Nothing is incidental.
              </p>
            </div>
          </div>

          {/* Atmosphere card */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-4">
            <div className="bg-card border border-border/20 rounded-sm p-8 space-y-3">
              <h3 className="font-display text-lg tracking-wider text-foreground">
                A ROOM THAT HOLDS YOU
              </h3>
              <p className="text-muted-foreground font-body text-sm leading-loose">
                Step inside and feel the shift — warm amber light, the low hum of conversation, interiors that draw from the hammams and caravanserais of the ancient world. Verdura is a place designed for lingering: for families gathering over a shared platter, for friends who let the night unspool over a second glass. The food is the reason you come. The feeling is the reason you return.
              </p>
            </div>
            <div className="hidden md:block relative rounded-sm overflow-hidden">
              <img src={RESERVATION_IMG} alt="Verdura dining room" className="absolute inset-0 w-full h-full object-cover" />
            </div>
          </div>

          {/* Closing invitation */}
          <div className="bg-accent/10 border border-accent/20 rounded-sm p-8 text-center space-y-4">
            <h3 className="font-display text-2xl md:text-3xl text-foreground tracking-wide">
              COME TO THE TABLE
            </h3>
            <p className="text-muted-foreground font-body text-sm leading-loose max-w-md mx-auto">
              Verdura sits at the centre of Dunedin — welcoming, unhurried, unmistakably its own. Whether you arrive for a quiet dinner or a long, celebratory evening, a place is set for you. We would be honoured to cook for you.
            </p>
            <div className="flex items-center justify-center gap-2 text-xs tracking-[0.15em] text-accent font-body">
              <MapPin size={13} />
              <span>DUNEDIN CENTRAL, NEW ZEALAND</span>
            </div>
            <div className="flex justify-center gap-4 pt-2">
              <Link to="/menu" className="text-xs tracking-[0.15em] font-body border border-foreground/30 text-foreground px-6 py-2.5 hover:bg-foreground hover:text-background transition-colors">
                VIEW MENU
              </Link>
              <Link to="/book" className="text-xs tracking-[0.15em] font-body bg-foreground text-background px-6 py-2.5 hover:bg-foreground/80 transition-colors">
                RESERVE A TABLE
              </Link>
            </div>
          </div>

        </div>
      </div>
      <Footer />
    </div>
  );
}