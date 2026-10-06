import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import StepProgress from '../components/reservation/StepProgress';
import CancelBar from '../components/reservation/CancelBar';
import ReservationSummary from '../components/reservation/ReservationSummary';
import Step1Details from '../components/reservation/Step1Details';
import Step2Guests from '../components/reservation/Step2Guests';
import Step3Menu from '../components/reservation/Step3Menu';
import Step4Review from '../components/reservation/Step4Review';
import Step5Payment from '../components/reservation/Step5Payment';
import { createReservation } from '../api/reservations';

const STORAGE_KEY = 'verdura_reservation_draft';

const defaultReservation = {
  date: '', time: '', guests: 2, occasion: '', requests: '',
  name: '', email: '', phone: '',
  guestSetup: [],
  menuSelections: {},
  // Card/Apple Pay/Google Pay are not offered — DL-048 defers online card
  // payment for MVP; only bank transfer or pay-at-restaurant are real.
  paymentMethod: 'pay_at_restaurant',
  promoCode: '',
};

export default function BookTable() {
  const [step, setStep] = useState(1);
  const [reservation, setReservation] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : defaultReservation;
    } catch { return defaultReservation; }
  });
  const [confirmed, setConfirmed] = useState(false);

  const [bookingRef, setBookingRef] = useState('');

  function handleCancel() {
    setReservation(defaultReservation);
    setStep(1);
    setConfirmed(false);
    setBookingRef('');
    localStorage.removeItem(STORAGE_KEY);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reservation));
  }, [reservation]);

  function update(patch) {
    setReservation(prev => ({ ...prev, ...patch }));
  }

  function goTo(n) {
    setStep(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function next() { goTo(step + 1); }
  function back() { goTo(step - 1); }

  // Only ever set `confirmed`/`bookingRef` from a real, persisted backend
  // response — never fabricated, never set before the request succeeds.
  // Step5Payment awaits this and shows the real error message if it throws.
  async function handleConfirm() {
    const created = await createReservation(reservation);
    setBookingRef(created.bookingRef);
    setConfirmed(true);
    localStorage.removeItem(STORAGE_KEY);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const menuTotal = Object.values(reservation.menuSelections).flat().reduce((s, i) => s + (i.price || 0), 0);

  return (
    <div className="booking-page min-h-screen bg-background">
      <Navbar />
      <div className="pt-20 min-h-screen">
        {!confirmed && (
          <div className="booking-progress px-4 md:px-8 max-w-7xl mx-auto">
            <StepProgress step={step} />
          </div>
        )}

        <div className="max-w-7xl mx-auto px-4 md:px-8 pb-16">
          <div className="light-page booking-surface rounded-sm px-6 md:px-10 py-8 md:py-10">
            {confirmed ? (
              <Step5Payment
                reservation={reservation}
                menuTotal={menuTotal}
                bookingRef={bookingRef}
                confirmed={confirmed}
                onConfirm={handleConfirm}
                update={update}
                onBack={back}
              />
            ) : (
              <div className="flex gap-8 items-start">
                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div style={{ animation: 'stepFade 0.4s ease-out' }}>
                    {step === 1 && <Step1Details reservation={reservation} update={update} onNext={next} />}
                    {step === 2 && <Step2Guests reservation={reservation} update={update} onNext={next} onBack={back} />}
                    {step === 3 && <Step3Menu reservation={reservation} update={update} onNext={next} onBack={back} menuTotal={menuTotal} />}
                    {step === 4 && <Step4Review reservation={reservation} menuTotal={menuTotal} onNext={next} onBack={back} goTo={goTo} />}
                    {step === 5 && (
                      <Step5Payment
                        reservation={reservation}
                        menuTotal={menuTotal}
                        bookingRef={bookingRef}
                        confirmed={false}
                        onConfirm={handleConfirm}
                        update={update}
                        onBack={back}
                      />
                    )}
                  </div>
                  <div className="mt-8 pt-4 border-t border-border/10">
                    <CancelBar onCancel={handleCancel} />
                  </div>
                </div>

                {/* Desktop sidebar */}
                <div className="hidden xl:block w-80 flex-shrink-0 sticky top-24">
                  <ReservationSummary reservation={reservation} menuTotal={menuTotal} step={step} goTo={goTo} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile sticky bottom bar */}
        {!confirmed && (
          <div className="light-page booking-mobile-summary xl:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/98 backdrop-blur-md border-t border-border/30 px-4 py-3">
            <ReservationSummary reservation={reservation} menuTotal={menuTotal} step={step} goTo={goTo} mobile />
          </div>
        )}
      </div>

      <style>{`
        @keyframes stepFade {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
