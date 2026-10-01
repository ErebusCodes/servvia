import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import SectionDivider from '../components/SectionDivider';
import { Instagram, Facebook, X as XIcon, ExternalLink } from 'lucide-react';
import { ASSETS } from '@/assets/index.js';

const HERO_IMG = ASSETS.hero.contact;
const MAP_URL = 'https://www.google.com/maps?q=17+Saint+Andrew+Street,+Dunedin+9016,+New+Zealand&output=embed';

const openingHours = [
  ['Monday', '11:00 am – 3:00 pm / 4:30 pm – 10:30 pm'],
  ['Tuesday', '1:00 pm – 3:00 pm / 4:30 pm – 10:30 pm'],
  ['Wednesday', '1:00 pm – 3:00 pm / 4:30 pm – 10:30 pm'],
  ['Thursday', '1:00 pm – 3:00 pm / 4:30 pm – 10:30 pm'],
  ['Friday', '4:30 pm – 10:30 pm'],
  ['Saturday', '1:00 pm – 3:00 pm / 4:30 pm – 10:30 pm'],
  ['Sunday', '1:00 pm – 3:00 pm / 4:30 pm – 10:30 pm'],
];

const deliveryHours = [
  ['Monday', '11:00 am – 3:00 pm / 5:00 pm – 9:00 pm'],
  ['Tuesday', '1:00 pm – 3:00 pm / 5:00 pm – 9:00 pm'],
  ['Wednesday', '1:00 pm – 3:00 pm / 5:00 pm – 9:00 pm'],
  ['Thursday', '1:00 pm – 3:00 pm / 5:00 pm – 9:00 pm'],
  ['Friday', '5:00 pm – 9:00 pm'],
  ['Saturday', '1:00 pm – 3:00 pm / 5:00 pm – 9:00 pm'],
  ['Sunday', '1:00 pm – 3:00 pm / 5:00 pm – 9:00 pm'],
];

function HoursPanel({ title, hours }) {
  return (
    <section className="border border-white/[0.04] bg-card px-6 py-5 md:px-10 md:py-7 lg:px-12">
      <SectionDivider title={`${title} — OPEN 7 DAYS`} />
      <dl className="space-y-2 pb-2 font-body text-[13px] md:text-sm">
        {hours.map(([day, time]) => (
          <div key={day} className="grid grid-cols-[90px_1fr] items-baseline gap-4 md:grid-cols-[120px_1fr]">
            <dt className="text-foreground">{day}</dt>
            <dd className="text-right text-muted-foreground">{time}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function Contact() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
        <div className="relative aspect-[1.54/1] w-full lg:aspect-auto lg:h-full lg:min-h-screen">
          <img src={HERO_IMG} alt="Seared tuna with fresh greens" className="absolute inset-0 h-full w-full object-cover" />
        </div>

        <div className="space-y-4 p-4 pt-20 md:p-8 md:pt-24 lg:p-10">
          <HoursPanel title="OPENING HOURS" hours={openingHours} />
          <HoursPanel title="DELIVERY HOURS" hours={deliveryHours} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="min-h-[420px] overflow-hidden border border-white/[0.04] bg-card md:min-h-[500px]">
              <iframe title="Verdura location at 17 Saint Andrew Street" src={MAP_URL} className="h-full min-h-[420px] w-full md:min-h-[500px]" loading="lazy" />
            </div>

            <section className="border border-white/[0.04] bg-card px-7 py-6 md:px-10">
              <SectionDivider title="CONTACT" />
              <div className="space-y-5 font-body text-sm">
                <div>
                  <h3 className="mb-1 text-xs tracking-wider text-muted-foreground">ADDRESS</h3>
                  <p className="leading-relaxed text-foreground">17 Saint Andrew Street<br />Central Dunedin, Dunedin 9016<br />New Zealand</p>
                  <a href="https://maps.google.com/?q=17+Saint+Andrew+Street+Dunedin" target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-foreground">Get Directions <ExternalLink size={12} /></a>
                </div>
                <div><h3 className="mb-1 text-xs tracking-wider text-muted-foreground">PHONE</h3><a className="text-foreground hover:text-accent" href="tel:+6434749692">03 474 9692</a></div>
                <div><h3 className="mb-1 text-xs tracking-wider text-muted-foreground">EMAIL</h3><a className="break-all text-foreground hover:text-accent" href="mailto:bookings.verdura@gmail.com">bookings.verdura@gmail.com</a></div>
                <div><h3 className="mb-1 text-xs tracking-wider text-muted-foreground">BYO / LICENSE</h3><p className="text-foreground">We are fully licensed and we do BYO</p></div>
                <div>
                  <h3 className="mb-2 text-xs tracking-wider text-muted-foreground">FOLLOW</h3>
                  <div className="flex gap-4">
                    <a href="#instagram" aria-label="Instagram" className="text-foreground hover:text-accent"><Instagram size={18} /></a>
                    <a href="#facebook" aria-label="Facebook" className="text-foreground hover:text-accent"><Facebook size={18} /></a>
                    <a href="#x" aria-label="X" className="text-foreground hover:text-accent"><XIcon size={18} /></a>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
