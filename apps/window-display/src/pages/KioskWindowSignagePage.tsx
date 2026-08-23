import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './KioskWindowSignagePage.css';
import { KioskFullscreenShell } from '../components/KioskFullscreenShell';
import { FullscreenGate } from '../components/FullscreenGate';
import {
  createDefaultKioskPublishedConfig,
  DEFAULT_KIOSK_PLAYLIST_TEMPLATE,
  DEFAULT_KIOSK_ROTATION_STRATEGY,
  getPublishedConfigCookieRevision,
  readPublishedConfigCookies,
} from '../../../../shared/kiosk/kioskConfig.mjs';

// Served from Verdura's canonical GCS public-media bucket (same object
// customer-website's Home.jsx uses — see README §4.3 / decisions-log DL-103)
// instead of a local/symlinked public asset, so it is not bundled into this
// app's build output.
const introVideo = 'https://storage.googleapis.com/verdura-media-public-d3794338b2/website/hero/intro.mp4';

interface Category { id: string; name: string; subs?: Array<{ id: string; name: string }> }
interface MenuItem {
  id: string;
  categoryId: string;
  subCategory: string | null;
  title: string;
  description: string;
  imageUrl: string | null;
  price: string;
  nutritionalDetails?: { tags?: string[] };
}
interface MenuItemSetting { id: string; enabled: boolean; badge: string; kioskSortOrder: number }
interface Promotion { id: string; title: string; badge: string; text: string; priority: number; enabled: boolean }
interface Video { id: string; name: string; durationSec: number; order: number; autoplay: boolean; loop: boolean; mute: boolean; enabled: boolean; res: string; sourceUrl?: string }
interface DisplaySettings {
  slideDuration: number;
  transition: 'dissolve' | 'fade' | 'slide' | 'zoom';
  rotateMenu: boolean;
  rotatePromos: boolean;
  rotateVideos: boolean;
  scheduleEnabled: boolean;
  playlist: string;
}
interface Branding { name: string; tagline: string; kicker: string; supportingText: string; accentColor: string }
type PlaylistKind = 'intro' | 'hero' | 'supporting' | 'pizza' | 'video' | 'promotion' | 'dessert' | 'drinks' | 'qr';
interface PlaylistTemplateEntry { kind: PlaylistKind; offset?: number }
interface PublishedConfig {
  categories: Category[];
  menuItems: MenuItem[];
  menuItemSettings: MenuItemSetting[];
  promos: Promotion[];
  videos: Video[];
  settings: DisplaySettings;
  branding: Branding;
  rotationStrategy?: {
    heroTitles: string[];
    supportingTitles: string[];
    pizzaTitles: string[];
    dessertTitles: string[];
    drinkTitles: string[];
    heroWeight: number;
    pizzaInterval: number;
    maxConsecutivePlatters: number;
    alternateVideos: boolean;
  };
  playlistTemplate?: PlaylistTemplateEntry[];
}
interface PublishedItem extends MenuItem { badge: string; categoryName: string }
type PlaylistSlide =
  | { kind: 'intro'; label: string; durationMs: number }
  | { kind: 'item'; label: string; item: PublishedItem; badgeFallback: string; align: 'left' | 'center' | 'right' | 'spotlight'; durationMs: number }
  | { kind: 'video'; label: string; video: Video; source: string; durationMs: number }
  | { kind: 'promotion'; label: string; promotion: Promotion; backdropItem?: PublishedItem; durationMs: number }
  | { kind: 'dessert'; label: string; items: PublishedItem[]; durationMs: number }
  | { kind: 'drinks'; label: string; items: PublishedItem[]; durationMs: number }
  | { kind: 'qr'; label: string; durationMs: number };

const isPublishedConfig = (value: unknown): value is PublishedConfig => {
  if (!value || typeof value !== 'object') return false;
  const config = value as Partial<PublishedConfig>;
  return Array.isArray(config.categories)
    && Array.isArray(config.menuItems)
    && Array.isArray(config.menuItemSettings)
    && Array.isArray(config.promos)
    && Array.isArray(config.videos)
    && Boolean(config.settings)
    && Boolean(config.branding);
};

// A neutral Verdura-branded placeholder — never an unrelated stock dish photo —
// shown only when a published item has no verified menu image.
const fallbackPhoto = '/branding/verdura-fallback.svg';

function itemPhoto(item: PublishedItem | undefined, revision: string) {
  const url = item?.imageUrl;
  if (!url) return fallbackPhoto;
  if (!revision) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(revision)}`;
}

function DietaryTags({ item }: { item?: PublishedItem }) {
  if (!item?.nutritionalDetails?.tags?.length) return null;
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 30 }}>
      {item.nutritionalDetails.tags.map(tag => {
        const isShort = tag.length <= 2;
        const displayTag = tag.toLowerCase().includes('spicy') && !tag.includes('🔥') ? `🔥 ${tag}` : tag;
        return (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 48,
              minWidth: isShort ? 48 : undefined,
              padding: '0 18px',
              borderRadius: 999,
              border: '1.5px solid rgba(198,161,82,.5)',
              color: 'var(--gold-bright)',
              font: "700 19px/1 'Inter'",
              letterSpacing: '.04em',
              gap: 8
            }}
          >
            {displayTag}
          </span>
        );
      })}
    </div>
  );
}

function renderTitleWithServing(title: string) {
  const alternateName = title.match(/^(.+?)\s*(\[[^\]]+\])\s*$/);
  if (alternateName) {
    const baseTitle = alternateName[1] ?? '';
    const bracketedTitle = alternateName[2] ?? '';
    return (
      <>
        <span style={{ whiteSpace: 'nowrap' }}>{baseTitle.trim()}</span>
        <br />
        <span style={{ whiteSpace: 'nowrap' }}>{bracketedTitle}</span>
      </>
    );
  }

  const match = title.match(/\s*(\(serves\s+[^)]+\))\s*$/i);
  if (match) {
    const baseTitle = title.replace(match[0], '').trim();
    const servingText = match[1];
    return (
      <>
        {baseTitle}
        <br />
        <span style={{ display: 'inline-block', whiteSpace: 'nowrap', fontSize: '0.65em', fontWeight: 600, opacity: 0.85 }}>
          {servingText}
        </span>
      </>
    );
  }
  return title;
}

function MenuCard({ item, animClass, revision }: { item: PublishedItem; animClass: string; revision: string }) {
  const isSpicy = item.nutritionalDetails?.tags?.some(t => t.toLowerCase().includes('spicy'));
  const isVeg = item.nutritionalDetails?.tags?.some(t => t.toLowerCase().includes('vegetarian') || t.toLowerCase() === 'v');
  const isGF = item.nutritionalDetails?.tags?.some(t => t.toLowerCase().includes('gf') || t.toLowerCase() === 'gluten free');

  return (
    <div style={{ width: 476 }}>
      <div style={{ position: 'relative', height: 540, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(198,161,82,.18)' }}>
        <div key="kb-container" style={{ position: 'absolute', inset: 0, animation: `${animClass} 30s ease-in-out infinite alternate` }}>
          <img src={itemPhoto(item, revision)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 52%,rgba(8,7,6,.88))' }} />
        {item.badge && (
          <div style={{ position: 'absolute', top: 22, left: 22, display: 'inline-flex', padding: '9px 18px', borderRadius: 999, background: 'var(--gold)', color: '#1A1407', font: "700 16px/1 'Inter'", letterSpacing: '.14em', textTransform: 'uppercase' }}>
            {item.badge}
          </div>
        )}
        <div style={{ position: 'absolute', left: 28, right: 28, bottom: 26 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 600, fontSize: 46, color: 'var(--paper)', lineHeight: 1.1 }}>{renderTitleWithServing(item.title)}</div>
          <div style={{ font: "400 23px/1.4 'Inter'", color: 'var(--paper-dim)', marginTop: 6 }}>{item.description}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {isVeg && (
            <span style={{ height: 44, padding: '0 18px', display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: '1.5px solid rgba(198,161,82,.5)', color: 'var(--gold-bright)', font: "700 18px/1 'Inter'" }}>
              Vegetarian
            </span>
          )}
          {isGF && (
            <span style={{ height: 44, width: 48, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, border: '1.5px solid rgba(198,161,82,.5)', color: 'var(--gold-bright)', font: "700 18px/1 'Inter'" }}>
              GF
            </span>
          )}
          {isSpicy && (
            <span style={{ height: 44, padding: '0 18px', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1.5px solid rgba(198,161,82,.5)', color: 'var(--gold-bright)', font: "700 18px/1 'Inter'" }}>
              🔥 Spicy
            </span>
          )}
        </div>
        <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 48, color: 'var(--gold-bright)' }}>${item.price}</div>
      </div>
    </div>
  );
}

function BookingQrCode() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const draw = () => {
      const QRCode = (window as typeof window & { QRCode?: any }).QRCode;
      if (!QRCode) return false;
      host.replaceChildren();
      new QRCode(host, { text: 'https://verdura.co.nz/book.html', width: 300, height: 300, colorDark: '#0A0908', colorLight: '#F7F2E8', correctLevel: QRCode.CorrectLevel.M });
      return true;
    };
    if (draw()) return;
    let attempts = 0;
    const timer = window.setInterval(() => { if (draw() || ++attempts > 50) window.clearInterval(timer); }, 150);
    return () => window.clearInterval(timer);
  }, []);

  return <div ref={hostRef} style={{ width: 300, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />;
}

export const KioskWindowSignagePage: React.FC = () => {
  const [config, setConfig] = useState<PublishedConfig>(() =>
    createDefaultKioskPublishedConfig() as PublishedConfig
  );
  // Bumped only when Admin publishes a new configuration (see writePublishedConfigCookies /
  // the local-storage broker). Appended as a query-versioning suffix to menu-image URLs so a
  // replaced image (same public path, new bytes) is reliably re-fetched instead of served
  // from a stale browser cache, while unrelated re-renders never change the URL.
  const [configRevision, setConfigRevision] = useState(() => getPublishedConfigCookieRevision() || String(Date.now()));

  const [slideIndex, setSlideIndex] = useState(0);
  const [playlistCycle, setPlaylistCycle] = useState(0);
  const [topPromoIndex, setTopPromoIndex] = useState(0);
  const [introVideoReady, setIntroVideoReady] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const introVideoRef = useRef<HTMLVideoElement>(null);
  const playlistVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let active = true;
    let revision = getPublishedConfigCookieRevision();
    const loadCookies = async () => {
      try {
        const published = await readPublishedConfigCookies();
        if (active && isPublishedConfig(published)) {
          setConfig(published);
          setConfigRevision(getPublishedConfigCookieRevision());
          setSlideIndex(0);
        }
      } catch (error) {
        console.error('Failed to read published kiosk configuration', error);
      }
    };
    void loadCookies();
    const cookieTimer = window.setInterval(() => {
      const nextRevision = getPublishedConfigCookieRevision();
      if (nextRevision && nextRevision !== revision) {
        revision = nextRevision;
        void loadCookies();
      }
    }, 750);

    const host = window.location.hostname === '127.0.0.1' ? '127.0.0.1' : 'localhost';
    const adminOrigin = `${window.location.protocol}//${host}:5176`;
    const iframe = document.createElement('iframe');
    iframe.src = `${adminOrigin}/local-storage-broker.html`;
    iframe.hidden = true;
    iframe.title = 'Published signage configuration';
    const subscribe = () => iframe.contentWindow?.postMessage({ type: 'SUBSCRIBE_KIOSK_PUBLISHED_CONFIG' }, adminOrigin);
    const receive = (event: MessageEvent) => {
      if (event.origin !== adminOrigin || event.data?.type !== 'KIOSK_PUBLISHED_CONFIG') return;
      if (!isPublishedConfig(event.data.config)) return;
      setConfig(event.data.config);
      setConfigRevision(String(Date.now()));
      setSlideIndex(0);
    };
    iframe.addEventListener('load', subscribe);
    window.addEventListener('message', receive);
    document.body.appendChild(iframe);
    return () => {
      active = false;
      window.clearInterval(cookieTimer);
      iframe.removeEventListener('load', subscribe);
      window.removeEventListener('message', receive);
      iframe.remove();
    };
  }, []);

  const publishedItems = useMemo<PublishedItem[]>(() => {
    if (!config?.settings.rotateMenu) return [];
    const items = new Map(config.menuItems.map(item => [item.id, item]));
    const categories = new Map(config.categories.map(category => [category.id, category.name]));
    return [...config.menuItemSettings]
      .filter(setting => setting.enabled && items.has(setting.id))
      .sort((a, b) => a.kioskSortOrder - b.kioskSortOrder)
      .map(setting => {
        const item = items.get(setting.id)!;
        return { ...item, badge: setting.badge, categoryName: categories.get(item.categoryId) || 'Menu' };
      });
  }, [config]);

  const promotions = useMemo(() => config?.settings.rotatePromos
    ? [...config.promos].filter(promo => promo.enabled).sort((a, b) => a.priority - b.priority)
    : [], [config]);
  const videos = useMemo(() => config?.settings.rotateVideos
    ? [...config.videos].filter(video => video.enabled).sort((a, b) => a.order - b.order)
    : [], [config]);
  const strategy = config.rotationStrategy || DEFAULT_KIOSK_ROTATION_STRATEGY;

  const baseDurationMs = Math.max(4, config?.settings.slideDuration || 8) * 1000;

  const playlistSlides = useMemo<PlaylistSlide[]>(() => {
    const template = config.playlistTemplate?.length ? config.playlistTemplate : DEFAULT_KIOSK_PLAYLIST_TEMPLATE;
    const pick = <T,>(items: T[], index: number): T | undefined => {
      if (!items.length) return undefined;
      return items[((index % items.length) + items.length) % items.length];
    };
    const itemByTitle = new Map(publishedItems.map(item => [item.title, item]));
    const resolveItems = (titles: string[]) => titles
      .map(title => itemByTitle.get(title))
      .filter((item): item is PublishedItem => Boolean(item));
    const heroItems = resolveItems(strategy.heroTitles);
    const supportingItems = resolveItems(strategy.supportingTitles);
    const pizzaItems = resolveItems(strategy.pizzaTitles);
    const dessertItems = resolveItems(strategy.dessertTitles);
    const drinkItems = resolveItems(strategy.drinkTitles);
    const fallbackItem = heroItems[0] || publishedItems[0];
    const slides: PlaylistSlide[] = [];
    let heroSlot = 0;
    let supportSlot = 0;
    let pizzaSlot = 0;
    let videoSlot = 0;
    let promoSlot = 0;

    template.forEach(entry => {
      if (entry.kind === 'intro') {
        slides.push({ kind: 'intro', label: 'Intro / brand screen', durationMs: baseDurationMs });
        return;
      }

      if (entry.kind === 'video') {
        const video = pick(videos, playlistCycle * Math.max(videos.length, 1) + (entry.offset ?? videoSlot));
        videoSlot += 1;
        if (!video) return;
        slides.push({
          kind: 'video',
          label: video.name,
          video,
          source: video.sourceUrl || introVideo,
          durationMs: Math.max(1, Number(video.durationSec) || config.settings.slideDuration || 8) * 1000,
        });
        return;
      }

      if (entry.kind === 'promotion') {
        const promotion = pick(promotions, playlistCycle * Math.max(promotions.length, 1) + (entry.offset ?? promoSlot));
        promoSlot += 1;
        if (!promotion) return;
        slides.push({ kind: 'promotion', label: promotion.title, promotion, backdropItem: fallbackItem, durationMs: baseDurationMs });
        return;
      }

      if (entry.kind === 'hero') {
        const item = pick(heroItems, playlistCycle * Math.max(heroItems.length, 1) + (entry.offset ?? heroSlot)) || fallbackItem;
        const align = (heroSlot % 2 === 0) ? 'left' : 'right';
        heroSlot += 1;
        if (!item) return;
        slides.push({ kind: 'item', label: item.title, item, badgeFallback: '★ Featured', align, durationMs: baseDurationMs });
        return;
      }

      if (entry.kind === 'supporting') {
        const item = pick(supportingItems, playlistCycle * Math.max(supportingItems.length, 1) + (entry.offset ?? supportSlot))
          || pick(heroItems, playlistCycle + supportSlot)
          || fallbackItem;
        const align = (supportSlot % 2 === 0) ? 'right' : 'left';
        supportSlot += 1;
        if (!item) return;
        slides.push({ kind: 'item', label: item.title, item, badgeFallback: 'Chef’s recommendation', align, durationMs: baseDurationMs });
        return;
      }

      if (entry.kind === 'pizza') {
        const item = pick(pizzaItems, playlistCycle * Math.max(pizzaItems.length, 1) + pizzaSlot);
        pizzaSlot += 1;
        if (!item) return;
        slides.push({ kind: 'item', label: item.title, item, badgeFallback: 'Spotlight', align: 'spotlight', durationMs: baseDurationMs });
        return;
      }

      if (entry.kind === 'dessert' && dessertItems.length) {
        slides.push({ kind: 'dessert', label: 'Traditional Mediterranean Desserts', items: dessertItems, durationMs: baseDurationMs });
        return;
      }

      if (entry.kind === 'drinks' && drinkItems.length) {
        slides.push({ kind: 'drinks', label: 'Traditional drinks', items: drinkItems, durationMs: baseDurationMs });
        return;
      }

      if (entry.kind === 'qr') {
        slides.push({ kind: 'qr', label: 'QR / Book a Table', durationMs: baseDurationMs });
      }
    });

    return slides.length ? slides : [
      { kind: 'intro', label: 'Intro / brand screen', durationMs: baseDurationMs },
      { kind: 'qr', label: 'QR / Book a Table', durationMs: baseDurationMs },
    ];
  }, [baseDurationMs, config.playlistTemplate, config.settings.slideDuration, playlistCycle, promotions, publishedItems, strategy, videos]);

  const totalSlides = playlistSlides.length;
  const activeSlide = playlistSlides[slideIndex] || playlistSlides[0];
  const activeDurationMs = activeSlide?.durationMs || baseDurationMs;

  // Edge-to-edge backdrop shown behind the letterboxed 1920x1080 stage, so the
  // margins left by the `contain` scale (see the resize effect below) fill with
  // a cover-cropped copy of the current slide's own media instead of black bars.
  // Purely decorative — never carries the slide's actual layout/typography.
  const backdropMedia = useMemo<{ type: 'image' | 'video'; src: string } | null>(() => {
    if (!activeSlide) return null;
    switch (activeSlide.kind) {
      case 'intro': {
        const heroItems = publishedItems.filter(item => strategy.heroTitles.includes(item.title));
        const heroItem = heroItems[0] || publishedItems[0];
        return { type: 'image', src: itemPhoto(heroItem, configRevision) };
      }
      case 'item':
        return { type: 'image', src: itemPhoto(activeSlide.item, configRevision) };
      case 'promotion':
        return { type: 'image', src: itemPhoto(activeSlide.backdropItem, configRevision) };
      case 'video':
        return { type: 'video', src: activeSlide.source };
      case 'dessert':
      case 'drinks':
        return { type: 'image', src: itemPhoto(activeSlide.items[0], configRevision) };
      case 'qr':
      default:
        return { type: 'image', src: fallbackPhoto };
    }
  }, [activeSlide, configRevision, publishedItems, strategy]);

  const promoHeadlines = useMemo<string[]>(() => {
    if (promotions.length) {
      return promotions.map(p => p.title);
    }
    const currentPlaylist = config.settings.playlist || 'Dinner';
    const C: Record<string, string[]> = {
      Dinner: ['Now serving dinner', 'Book a table for tonight', 'Charcoal grills till late'],
      Lunch: ['Lunch set $29', 'Two courses, one hour', 'Fresh off the grill at noon'],
      Weekend: ['Weekend sharing platters', 'Bring the whole table', 'Feast together this weekend'],
      Festive: ['Now taking festive bookings', 'Set menus for the season', 'Celebrate at Verdura'],
    };
    const list = C[currentPlaylist];
    if (list) {
      return list;
    }
    return ['Now serving dinner', 'Book a table for tonight', 'Charcoal grills till late'];
  }, [promotions, config.settings.playlist]);

  const advanceSlide = useCallback(() => {
    setSlideIndex(index => {
      const next = (index + 1) % Math.max(totalSlides, 1);
      if (next === 0) setPlaylistCycle(cycle => cycle + 1);
      return next;
    });
  }, [totalSlides]);

  useEffect(() => {
    const resize = () => {
      if (stageRef.current) stageRef.current.style.transform = `scale(${Math.min(window.innerWidth / 1920, window.innerHeight / 1080)})`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    if (slideIndex >= totalSlides) setSlideIndex(0);
  }, [slideIndex, totalSlides]);

  useEffect(() => {
    const timer = window.setTimeout(advanceSlide, activeDurationMs);
    return () => window.clearTimeout(timer);
  }, [activeDurationMs, advanceSlide, slideIndex]);

  useEffect(() => {
    const progress = progressRef.current;
    if (!progress) return;
    progress.style.transition = 'none';
    progress.style.width = '0%';
    void progress.offsetWidth;
    progress.style.transition = `width ${activeDurationMs}ms linear`;
    progress.style.width = '100%';
  }, [slideIndex, activeDurationMs]);

  useEffect(() => {
    const intro = introVideoRef.current;
    const playlistVideo = playlistVideoRef.current;
    if (intro) {
      if (activeSlide?.kind === 'intro') {
        intro.muted = true;
        if (intro.readyState >= 3) {
          setIntroVideoReady(true);
        }
        void intro.play().catch(() => undefined);
      } else {
        intro.pause();
      }
    }
    if (playlistVideo) {
      if (activeSlide?.kind === 'video') {
        playlistVideo.muted = activeSlide.video.mute;
        playlistVideo.loop = activeSlide.video.loop;
        playlistVideo.currentTime = 0;
        if (activeSlide.video.autoplay) {
          void playlistVideo.play().catch(() => undefined);
        } else {
          playlistVideo.pause();
        }
      } else {
        playlistVideo.pause();
      }
    }
  }, [activeSlide, slideIndex]);

  useEffect(() => {
    if (activeSlide?.kind !== 'intro') {
      setIntroVideoReady(false);
    }
  }, [activeSlide]);

  const handlePlaylistVideoEnded = useCallback(() => {
    if (activeSlide?.kind === 'video' && !activeSlide.video.loop) {
      advanceSlide();
    }
  }, [activeSlide, advanceSlide]);

  const handleIntroVideoEnded = useCallback(() => {
    if (activeSlide?.kind === 'intro') {
      advanceSlide();
    }
  }, [activeSlide, advanceSlide]);

  const renderSlide = (slide: PlaylistSlide, isCurrent: boolean) => {
    if (slide.kind === 'intro') {
      const heroItems = publishedItems.filter(item => strategy.heroTitles.includes(item.title));
      const heroItem = heroItems[0] || publishedItems[0];

      const tagline = config.branding.tagline || 'Fresh Mediterranean,\nover real charcoal.';
      let firstLine = tagline;
      let secondLine = '';
      if (tagline.includes('\n')) {
        const parts = tagline.split('\n');
        firstLine = parts[0] || '';
        secondLine = parts.slice(1).join('\n');
      } else if (tagline.includes(',')) {
        const idx = tagline.indexOf(',');
        firstLine = tagline.substring(0, idx + 1);
        secondLine = tagline.substring(idx + 1).trim();
      }

      return (
        <>
          <div key={isCurrent ? 'kb-active' : 'kb-inactive'} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, animation: 'kbA 24s ease-out infinite alternate' }}>
              <img src={itemPhoto(heroItem, configRevision)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          </div>
          <video
            ref={isCurrent ? introVideoRef : undefined}
            src={introVideo}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onCanPlay={() => {
              if (isCurrent) {
                setIntroVideoReady(true);
              }
            }}
            onEnded={handleIntroVideoEnded}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: (isCurrent && introVideoReady) ? 1 : 0,
              transition: 'opacity 900ms ease',
              zIndex: 1
            }}
          />
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(130% 95% at 72% 32%, transparent 28%, rgba(8,7,6,.45) 66%, rgba(8,7,6,.9) 100%), linear-gradient(180deg, rgba(8,7,6,.62) 0%, transparent 34%, transparent 52%, rgba(8,7,6,.94) 100%)', zIndex: 2 }} />
          <div style={{ position: 'absolute', left: 120, bottom: 196, maxWidth: 1180, zIndex: 3 }}>
            <div style={{ font: "600 22px/1 'Inter'", letterSpacing: '.36em', textTransform: 'uppercase', color: 'var(--gold)' }}>
              {config.branding.kicker || 'Mediterranean Kitchen · Charcoal Grill'}
            </div>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 800, fontSize: 138, lineHeight: 0.96, letterSpacing: '-.015em', color: 'var(--paper)', margin: '30px 0 0' }}>
              {firstLine}
              {secondLine ? (
                <>
                  <br />
                  <span style={{ fontStyle: 'italic', fontWeight: 600, color: 'var(--gold-bright)' }}>
                    {secondLine}
                  </span>
                </>
              ) : null}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginTop: 40 }}>
              <div style={{ width: 96, height: 3, background: 'var(--gold)', transformOrigin: 'left', animation: 'ruleGrow 1.1s ease both' }} />
              <div style={{ font: "500 30px/1 'Inter'", letterSpacing: '.04em', color: 'var(--paper-dim)' }}>
                {config.branding.supportingText || 'Mezze · Grills · Sharing platters'}
              </div>
            </div>
          </div>
        </>
      );
    }

    if (slide.kind === 'video') {
      return (
        <video
          ref={isCurrent ? playlistVideoRef : undefined}
          src={slide.source}
          autoPlay={slide.video.autoplay}
          muted={slide.video.mute}
          loop={slide.video.loop}
          playsInline
          preload="auto"
          onEnded={handlePlaylistVideoEnded}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      );
    }

    if (slide.kind === 'promotion') {
      const promotion = slide.promotion;
      const badge = promotion.badge || 'Promotion';
      const text = promotion.text || 'Discover Verdura’s signature menu, served fresh from the charcoal grill.';

      const currentPlaylist = config.settings.playlist || 'Dinner';
      const validityText = currentPlaylist === 'Dinner' ? '5pm – late, daily'
        : currentPlaylist === 'Lunch' ? 'Lunch set $29 · 11am–3pm'
          : currentPlaylist === 'Weekend' ? 'Sat & Sun · groups of 4+'
            : 'Bookings open · festive menus';

      return (
        <>
          <div key={isCurrent ? 'kb-active' : 'kb-inactive'} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, animation: 'kbB 28s ease-out infinite alternate' }}>
              <img src={itemPhoto(slide.backdropItem, configRevision)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          </div>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 120% at 50% 45%, rgba(8,7,6,.4) 30%, rgba(8,7,6,.86) 100%)', zIndex: 2 }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 200px', zIndex: 3 }}>
            {badge && (
              <div style={{ display: 'inline-flex', alignItems: 'center', padding: '13px 28px', borderRadius: 999, border: '1.5px solid var(--gold)', background: 'rgba(198,161,82,.1)', color: 'var(--gold-bright)', font: "700 21px/1 'Inter'", letterSpacing: '.2em', textTransform: 'uppercase' }}>
                {badge}
              </div>
            )}
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 118, lineHeight: 1.02, letterSpacing: '-.015em', color: 'var(--paper)', margin: '36px 0 0' }}>
              {promotion.title}
            </h2>
            <p style={{ font: "400 36px/1.45 'Inter'", color: 'var(--paper-dim)', margin: '30px 0 0', maxWidth: 1180 }}>
              {text}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 36, marginTop: 50 }}>
              <div style={{ font: "600 26px/1 'Inter'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--gold)' }}>
                {validityText}
              </div>
              <div style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--gold-deep)' }} />
              <Link to="/book" style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '18px 38px', borderRadius: 999, background: 'var(--gold)', color: '#1A1407', font: "700 26px/1 'Inter'", letterSpacing: '.04em', textDecoration: 'none' }}>
                Book a Table&nbsp;&nbsp;→
              </Link>
            </div>
          </div>
        </>
      );
    }

    if (slide.kind === 'item') {
      const item = slide.item;
      const badge = item.badge || slide.badgeFallback;
      const isSpicy = item.nutritionalDetails?.tags?.some(t => t.toLowerCase().includes('spicy'));
      const isVeg = item.nutritionalDetails?.tags?.some(t => t.toLowerCase().includes('vegetarian') || t.toLowerCase() === 'v');
      const isGF = item.nutritionalDetails?.tags?.some(t => t.toLowerCase().includes('gf') || t.toLowerCase() === 'gluten free');

      const servesInfo = item.description.toLowerCase().includes('share') || item.description.toLowerCase().includes('feast')
        ? (item.description.toLowerCase().includes('four') || item.description.toLowerCase().includes('4') ? 'Serves four' : 'Serves two')
        : undefined;

      if (slide.align === 'spotlight') {
        return (
          <>
            <div key={isCurrent ? 'kb-active' : 'kb-inactive'} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, animation: 'kbC 28s ease-out infinite alternate' }}>
                <img src={itemPhoto(item, configRevision)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            </div>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(8,7,6,.7) 0%, transparent 30%, transparent 48%, rgba(8,7,6,.96) 100%)', zIndex: 2 }} />
            <div style={{ position: 'absolute', left: 120, right: 120, bottom: 150, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 60, zIndex: 3 }}>
              <div style={{ maxWidth: 1080 }}>
                {badge && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', padding: '12px 24px', borderRadius: 999, background: 'var(--gold)', color: '#1A1407', font: "700 19px/1 'Inter'", letterSpacing: '.16em', textTransform: 'uppercase' }}>
                    {badge}
                  </div>
                )}
                <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 124, lineHeight: 0.98, letterSpacing: '-.015em', color: 'var(--paper)', margin: '26px 0 0' }}>
                  {renderTitleWithServing(item.title)}
                </h2>
                <p style={{ font: "400 33px/1.45 'Inter'", color: 'var(--paper-dim)', margin: '22px 0 0', maxWidth: 920 }}>
                  {item.description}
                </p>
              </div>
              <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                {servesInfo && <div style={{ font: "500 24px/1 'Inter'", letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--paper-faint)' }}>{servesInfo}</div>}
                <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 136, lineHeight: 0.9, color: 'var(--gold-bright)', marginTop: 10 }}>
                  ${item.price}
                </div>
              </div>
            </div>
          </>
        );
      }

      if (slide.align === 'right') {
        return (
          <>
            {/* Opaque base beneath both panels: guards the seam where they meet against
                any sub-pixel compositing gap under the stage's transform scale — never
                visible on its own, since both panels already fully cover this area. */}
            <div style={{ position: 'absolute', inset: 0, background: 'var(--ink)' }} />
            <div key={isCurrent ? 'kb-active' : 'kb-inactive'} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '62%', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, animation: 'kbA 26s ease-out infinite alternate' }}>
                <img src={itemPhoto(item, configRevision)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(270deg, rgba(10,9,8,.2) 0%, transparent 38%, transparent 66%, rgba(10,9,8,1) 100%)' }} />
            </div>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '42%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 64px 0 116px', zIndex: 3 }}>
              {badge && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 11, alignSelf: 'flex-start', padding: '12px 24px', borderRadius: 999, border: '1.5px solid var(--gold)', background: 'rgba(198,161,82,.1)', color: 'var(--gold-bright)', font: "700 19px/1 'Inter'", letterSpacing: '.18em', textTransform: 'uppercase' }}>
                  {badge}
                </div>
              )}
              <div style={{ font: "600 22px/1 'Inter'", letterSpacing: '.34em', textTransform: 'uppercase', color: 'var(--gold)', marginTop: 34 }}>
                {item.categoryName}
              </div>
              <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 98, lineHeight: 1.0, letterSpacing: '-.015em', color: 'var(--paper)', margin: '18px 0 0' }}>
                {renderTitleWithServing(item.title)}
              </h2>
              <p style={{ font: "400 30px/1.5 'Inter'", color: 'var(--paper-dim)', margin: '26px 0 0', maxWidth: 620 }}>
                {item.description}
              </p>
              <div style={{ display: 'flex', gap: 12, marginTop: 30 }}>
                {isVeg && <span style={{ height: 44, padding: '0 18px', display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: '1.5px solid rgba(198,161,82,.5)', color: 'var(--gold-bright)', font: "700 18px/1 'Inter'" }}>Vegetarian</span>}
                {isGF && <span style={{ height: 44, width: 48, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, border: '1.5px solid rgba(198,161,82,.5)', color: 'var(--gold-bright)', font: "700 18px/1 'Inter'" }}>GF</span>}
                {isSpicy && <span style={{ height: 44, padding: '0 18px', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1.5px solid rgba(198,161,82,.5)', color: 'var(--gold-bright)', font: "700 18px/1 'Inter'" }}>🔥 Spicy</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, marginTop: 44 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 92, lineHeight: 1, color: 'var(--gold-bright)' }}>
                  ${item.price}
                </div>
                {servesInfo && <div style={{ font: "500 25px/1 'Inter'", letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--paper-faint)' }}>{servesInfo}</div>}
              </div>
            </div>
          </>
        );
      }

      return (
        <>
          {/* Opaque base beneath both panels: guards the seam where they meet against
              any sub-pixel compositing gap under the stage's transform scale — never
              visible on its own, since both panels already fully cover this area. */}
          <div style={{ position: 'absolute', inset: 0, background: 'var(--ink)' }} />
          <div key={isCurrent ? 'kb-active' : 'kb-inactive'} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '62%', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, animation: 'kbC 26s ease-out infinite alternate' }}>
              <img src={itemPhoto(item, configRevision)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(10,9,8,.2) 0%, transparent 38%, transparent 66%, rgba(10,9,8,1) 100%)' }} />
          </div>
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '42%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 116px 0 64px', zIndex: 3 }}>
            {badge && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 11, alignSelf: 'flex-start', padding: '12px 24px', borderRadius: 999, background: 'var(--gold)', color: '#1A1407', font: "700 19px/1 'Inter'", letterSpacing: '.16em', textTransform: 'uppercase' }}>
                {badge}
              </div>
            )}
            <div style={{ font: "600 22px/1 'Inter'", letterSpacing: '.34em', textTransform: 'uppercase', color: 'var(--gold)', marginTop: 34 }}>
              {item.categoryName}
            </div>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 98, lineHeight: 1.0, letterSpacing: '-.015em', color: 'var(--paper)', margin: '18px 0 0' }}>
              {renderTitleWithServing(item.title)}
            </h2>
            <p style={{ font: "400 30px/1.5 'Inter'", color: 'var(--paper-dim)', margin: '26px 0 0', maxWidth: 620 }}>
              {item.description}
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 30 }}>
              {isVeg && <span style={{ height: 44, padding: '0 18px', display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: '1.5px solid rgba(198,161,82,.5)', color: 'var(--gold-bright)', font: "700 18px/1 'Inter'" }}>Vegetarian</span>}
              {isGF && <span style={{ height: 44, width: 48, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, border: '1.5px solid rgba(198,161,82,.5)', color: 'var(--gold-bright)', font: "700 18px/1 'Inter'" }}>GF</span>}
              {isSpicy && <span style={{ height: 44, padding: '0 18px', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1.5px solid rgba(198,161,82,.5)', color: 'var(--gold-bright)', font: "700 18px/1 'Inter'" }}>🔥 Spicy</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, marginTop: 42 }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 92, lineHeight: 1, color: 'var(--gold-bright)' }}>
                ${item.price}
              </div>
              {servesInfo && <div style={{ font: "500 25px/1 'Inter'", letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--paper-faint)' }}>{servesInfo}</div>}
            </div>
          </div>
        </>
      );
    }

    if (slide.kind === 'dessert') {
      const displayItems = slide.items.slice(0, 3);
      return (
        <>
          <div style={{ position: 'absolute', top: 108, left: 0, right: 0, textAlign: 'center' }}>
            <div style={{ font: "600 22px/1 'Inter'", letterSpacing: '.36em', textTransform: 'uppercase', color: 'var(--gold)' }}>
              Sweet Endings
            </div>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 90, lineHeight: 1, letterSpacing: '-.01em', color: 'var(--paper)', margin: '18px 0 0' }}>
              Desserts
            </h2>
            <div style={{ font: "400 28px/1 'Inter'", color: 'var(--paper-faint)', marginTop: 16 }}>
              Honeyed, warm and made in-house
            </div>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 380, display: 'flex', gap: 52, justifyContent: 'center' }}>
            {displayItems.map((item, idx) => {
              const animations = ['kbSlow', 'kbSlow', 'kbSlow'];
              const anim = animations[idx % 3] || 'kbSlow';
              return <MenuCard key={item.id} item={item} animClass={anim} revision={configRevision} />;
            })}
          </div>
        </>
      );
    }

    if (slide.kind === 'drinks') {
      const displayItems = slide.items.slice(0, 3);
      return (
        <>
          <div style={{ position: 'absolute', top: 108, left: 0, right: 0, textAlign: 'center' }}>
            <div style={{ font: "600 22px/1 'Inter'", letterSpacing: '.36em', textTransform: 'uppercase', color: 'var(--gold)' }}>
              From the Bar
            </div>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 90, lineHeight: 1, letterSpacing: '-.01em', color: 'var(--paper)', margin: '18px 0 0' }}>
              Drinks &amp; Refreshers
            </h2>
            <div style={{ font: "400 28px/1 'Inter'", color: 'var(--paper-faint)', marginTop: 16 }}>
              Fresh juices · Mocktails · Coffee
            </div>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 380, display: 'flex', gap: 52, justifyContent: 'center' }}>
            {displayItems.map((item, idx) => {
              const animations = ['kbSlow', 'kbSlow', 'kbSlow'];
              const anim = animations[idx % 3] || 'kbSlow';
              return <MenuCard key={item.id} item={item} animClass={anim} revision={configRevision} />;
            })}
          </div>
        </>
      );
    }

    // QR Book Table slide (Slide 9)
    return (
      <>
        <div style={{ position: 'absolute', left: 120, top: 0, bottom: 0, width: '50%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ font: "600 22px/1 'Inter'", letterSpacing: '.36em', textTransform: 'uppercase', color: 'var(--gold)' }}>
            Hungry? Step inside
          </div>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 124, lineHeight: 1.0, letterSpacing: '-.015em', color: 'var(--paper)', margin: '24px 0 0' }}>
            Reserve your<br />
            <span style={{ fontStyle: 'italic', fontWeight: 600, color: 'var(--gold-bright)' }}>table tonight.</span>
          </h2>
          <div style={{ display: 'flex', gap: 20, marginTop: 50 }}>
            <Link to="/book" style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '20px 46px', borderRadius: 999, background: 'var(--gold)', color: '#1A1407', font: "700 27px/1 'Inter'", letterSpacing: '.02em', textDecoration: 'none' }}>
              Book a Table&nbsp;&nbsp;→
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginTop: 54 }}>
            <div style={{ font: "600 26px/1 'Inter'", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--paper)' }}>
              Open daily · 11am – late
            </div>
            <div style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--gold-deep)' }} />
            <div style={{ font: "500 26px/1 'Inter'", letterSpacing: '.04em', color: 'var(--paper-faint)' }}>
              @verdura
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', right: 150, top: 0, bottom: 0, width: '36%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ padding: 34, borderRadius: 28, background: 'var(--paper)', boxShadow: '0 40px 120px rgba(0,0,0,.6)' }}>
            <BookingQrCode />
          </div>
          <div style={{ font: "600 27px/1 'Inter'", letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gold-bright)', marginTop: 34 }}>
            Scan to book
          </div>
          <div style={{ font: "500 24px/1 'Inter'", letterSpacing: '.06em', color: 'var(--paper-faint)', marginTop: 14 }}>
            verdura.co.nz/book.html
          </div>
        </div>
      </>
    );
  };

  useEffect(() => {
    if (!promoHeadlines.length) return;
    const timer = window.setInterval(() => setTopPromoIndex(index => (index + 1) % promoHeadlines.length), 6000);
    return () => window.clearInterval(timer);
  }, [promoHeadlines.length]);

  const getSlideStyle = (index: number): React.CSSProperties => {
    const isActive = slideIndex === index;
    const transitionType = config.settings.transition || 'fade';

    let transform = undefined;
    if (transitionType === 'slide') {
      transform = isActive ? 'translateX(0)' : 'translateX(30px)';
    } else if (transitionType === 'zoom') {
      transform = isActive ? 'scale(1)' : 'scale(1.02)';
    }

    return {
      position: 'absolute',
      inset: 0,
      opacity: isActive ? 1 : 0,
      transform,
      transition: transitionType === 'zoom'
        ? 'opacity 1100ms cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 1100ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
        : transitionType === 'slide'
          ? 'opacity 1100ms cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 1100ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
          : 'opacity 1100ms ease',
      zIndex: isActive ? 2 : 1,
      pointerEvents: isActive ? 'auto' : 'none',
    };
  };

  return (
    <KioskFullscreenShell className="signage-root">
      <FullscreenGate variant="tap" />
      <div className="signage-backdrop" aria-hidden="true">
        {backdropMedia?.type === 'video' ? (
          <video
            key={backdropMedia.src}
            src={backdropMedia.src}
            className="signage-backdrop-media"
            autoPlay
            muted
            loop
            playsInline
          />
        ) : (
          <img key={backdropMedia?.src} src={backdropMedia?.src} alt="" className="signage-backdrop-media" />
        )}
      </div>
      <div ref={stageRef} className="signage-stage" style={{ '--gold-deep': '#8A6D2E', '--gold': config.branding.accentColor || '#C6A152', '--gold-bright': '#E8CE86' } as React.CSSProperties}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, zIndex: 50, background: 'rgba(255,255,255,.06)' }}>
          <div ref={progressRef} style={{ height: '100%', width: '0%', background: 'linear-gradient(90deg,var(--gold-deep),var(--gold-bright))', boxShadow: '0 0 14px rgba(198,161,82,.7)' }} />
        </div>
        <header style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 104, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 64px', background: 'linear-gradient(180deg,rgba(8,7,6,.72),transparent)', pointerEvents: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22V11" />
              <path d="M12 13c0-3.3 2.4-5.6 5.5-5.6C17.5 10.7 15.1 13 12 13z" />
              <path d="M12 15c0-3.3-2.4-5.6-5.5-5.6C6.5 12.7 8.9 15 12 15z" />
            </svg>
            <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 600, fontSize: 34, letterSpacing: '.42em', color: 'var(--paper)', paddingLeft: '.42em' }}>
              {config.branding.name}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 9, height: 9, borderRadius: 99, background: 'var(--gold)', animation: 'softPulse 2.4s ease-in-out infinite' }} />
            <span style={{ font: "600 25px/1 'Inter'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--gold-bright)' }}>
              {promoHeadlines[topPromoIndex] || (config.settings.scheduleEnabled ? config.settings.playlist : 'Now serving')}
            </span>
          </div>
        </header>

        {playlistSlides.map((slide, index) => {
          const isActive = slideIndex === index;
          const isPrev = (slideIndex - 1 + totalSlides) % totalSlides === index;
          const isNext = (slideIndex + 1) % totalSlides === index;
          const shouldRender = isActive || isPrev || isNext;

          if (!shouldRender) return null;

          return (
            <section
              key={`${slide.kind}-${index}-${slide.label}`}
              data-slide-kind={slide.kind}
              data-slide-label={slide.label}
              style={getSlideStyle(index)}
            >
              {renderSlide(slide, isActive)}
            </section>
          );
        })}

        <footer style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 92, zIndex: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 64px', background: 'linear-gradient(0deg,rgba(8,7,6,.85),transparent)', pointerEvents: 'none' }}>
          <div />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {Array.from({ length: totalSlides }).map((_, index) => (
              <button
                key={index}
                aria-label={`Show slide ${index + 1}`}
                onClick={() => setSlideIndex(index)}
                style={{
                  width: index === slideIndex ? 34 : 8,
                  height: 8,
                  padding: 0,
                  border: 0,
                  borderRadius: 99,
                  background: index === slideIndex ? 'var(--gold)' : 'rgba(255,255,255,.18)',
                  transition: 'all .5s ease',
                  cursor: 'pointer',
                  pointerEvents: 'auto'
                }}
              />
            ))}
          </div>
          <Link to="/menu" style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '14px 30px', borderRadius: 999, border: '1.5px solid var(--gold)', color: 'var(--gold-bright)', font: "700 22px/1 'Inter'", letterSpacing: '.1em', textTransform: 'uppercase', textDecoration: 'none', pointerEvents: 'auto' }}>
            View Menu
          </Link>
        </footer>
      </div>
    </KioskFullscreenShell>
  );
};

const photoLayer: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };
