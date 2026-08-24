import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  compareMenuItemsAlphabetically,
  SEED_CATEGORIES,
  SEED_ITEMS,
} from '../../shared/menu/menuData';
import {
  createDefaultKioskMenuSettings,
  DEFAULT_KIOSK_BRANDING,
  DEFAULT_KIOSK_PROMOS,
  DEFAULT_KIOSK_PLAYLIST_TEMPLATE,
  DEFAULT_KIOSK_ROTATION_STRATEGY,
  DEFAULT_KIOSK_SETTINGS,
  DEFAULT_KIOSK_VIDEOS,
  writePublishedConfigCookies,
} from '../../../../../shared/kiosk/kioskConfig.mjs';

// ─────────────────────────────────── Types ──────────────────────────────────

interface CategorySub {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  subs: CategorySub[];
}

interface NutritionalDetails {
  tags?: string[];
  isFeatured?: boolean;
}

interface MenuItem {
  id: string;
  categoryId: string;
  subCategory: string | null;
  title: string;
  description: string;
  imageUrl: string | null;
  price: string;
  nutritionalDetails: NutritionalDetails;
  isSpicy: boolean;
  isAvailable: boolean;
  sortOrder: number;
}

interface KioskMenuItem extends MenuItem {
  kioskEnabled: boolean;
  kioskBadge: string;
  kioskSortOrder: number;
  categoryName: string;
}

interface KioskSettings {
  slideDuration: number;
  transition: 'dissolve' | 'fade' | 'slide' | 'zoom';
  rotateMenu: boolean;
  rotatePromos: boolean;
  rotateVideos: boolean;
  scheduleEnabled: boolean;
  playlist: string;
}

interface Promotion {
  id: string;
  title: string;
  badge: string;
  text: string;
  priority: number;
  start: string;
  end: string;
  enabled: boolean;
}

interface Video {
  id: string;
  name: string;
  durationSec: number;
  order: number;
  autoplay: boolean;
  loop: boolean;
  mute: boolean;
  enabled: boolean;
  res: string;
}

interface KioskMenuItemSetting {
  id: string;
  enabled: boolean;
  badge: string;
  kioskSortOrder: number;
}

const PUBLISHED_BRANDING = DEFAULT_KIOSK_BRANDING;

// ─────────────────────────────── Local storage ───────────────────────────────

const SK = {
  categories: 'verdura_menu_categories_v3',
  items: 'verdura_menu_items_v3',
  kioskSettings: 'verdura_kiosk_settings_v1',
  kioskPromos: 'verdura_kiosk_promos_v1',
  kioskVideos: 'verdura_kiosk_videos_v1',
  // Bumped alongside menuData.mjs's item-id regeneration: stored settings key by
  // item id, and a stale cache can coincidentally "match" unrelated new items by
  // numeric id overlap, silently applying the wrong enabled/badge/sortOrder.
  kioskMenuItems: 'verdura_kiosk_menu_items_v2',
  kioskPublishedSnapshot: 'verdura_kiosk_published_snapshot_v1',
  kioskLastPublished: 'verdura_kiosk_last_published_v1',
};

function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    if (!s || s === 'null' || s === 'undefined') return fallback;
    const parsed = JSON.parse(s);
    if (parsed === null || parsed === undefined) return fallback;
    if (typeof parsed === 'object' && typeof fallback === 'object' && fallback !== null) {
      if (Array.isArray(fallback)) {
        return parsed as T;
      }
      return { ...fallback, ...parsed } as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

// ─────────────────────────────── Shared UI Components ─────────────────────────

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md';
  label?: string;
}

function Switch({ checked, onChange, size = 'md', label }: SwitchProps) {
  const width = size === 'sm' ? 32 : 40;
  const height = size === 'sm' ? 18 : 22;
  const knobSize = size === 'sm' ? 14 : 18;
  const leftChecked = size === 'sm' ? 16 : 20;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative rounded-full shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 transition-colors"
        style={{
          width,
          height,
          background: checked ? 'var(--color-primary)' : 'var(--color-border-strong)',
          border: 'none',
          padding: 0,
        }}
      >
        <span
          className="absolute bg-white rounded-full shadow-sm transition-all duration-150"
          style={{
            width: knobSize,
            height: knobSize,
            top: 2,
            left: checked ? leftChecked : 2,
          }}
        />
      </button>
      {label && <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>}
    </div>
  );
}

interface BadgeProps {
  children: React.ReactNode;
  tone?: 'primary' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral';
  variant?: 'soft' | 'solid';
  size?: 'sm' | 'md';
}

function Badge({ children, tone = 'neutral', size = 'sm' }: BadgeProps) {
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      color: 'var(--color-primary)',
      background: 'var(--color-primary-subtle)',
      borderColor: 'var(--color-success-border, var(--color-primary-subtle))',
    },
    warning: {
      color: 'var(--color-warning)',
      background: 'var(--color-warning-bg)',
      borderColor: 'var(--color-warning-border)',
    },
    danger: {
      color: 'var(--color-danger)',
      background: 'var(--color-danger-bg)',
      borderColor: 'var(--color-danger-border)',
    },
    info: {
      color: 'var(--color-info)',
      background: 'var(--color-info-bg)',
      borderColor: 'var(--color-info-border)',
    },
    accent: {
      color: 'var(--color-accent)',
      background: 'var(--color-accent-bg)',
      borderColor: 'var(--color-accent-border)',
    },
    neutral: {
      color: 'var(--color-text-secondary)',
      background: 'var(--color-surface-3)',
      borderColor: 'var(--color-border)',
    },
  };

  const currentStyle = styles[tone] || styles.neutral;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: size === 'sm' ? '2px 8px' : '4px 12px',
        fontSize: size === 'sm' ? '11px' : '12px',
        fontWeight: 600,
        borderRadius: 'var(--radius-xs, 4px)',
        border: '1px solid',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...currentStyle,
      }}
    >
      {children}
    </span>
  );
}

interface TabItem {
  key: string;
  label: string;
  badge?: number;
}

interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
}

function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', gap: '24px', width: '100%' }}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '10px 0',
              fontSize: '14px',
              fontWeight: isActive ? 600 : 500,
              cursor: 'pointer',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              outline: 'none',
            }}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 ? (
              <span
                style={{
                  marginLeft: '6px',
                  fontSize: '10.5px',
                  background: isActive ? 'var(--color-primary-subtle)' : 'var(--color-surface-3)',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  padding: '2px 6px',
                  borderRadius: '99px',
                  fontWeight: 600,
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.badge}
              </span>
            ) : null}
            {isActive && (
              <span
                style={{
                  position: 'absolute',
                  bottom: -1,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: 'var(--color-primary)',
                  borderRadius: '99px',
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string;
  leftIcon?: React.ReactNode;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function Input({ label, leftIcon, onChange, style, ...props }: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      {label && (
        <label style={{ fontSize: 'var(--text-sm-size)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text)' }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', width: '100%' }}>
        {leftIcon && (
          <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }}>
            {leftIcon}
          </div>
        )}
        <input
          onChange={onChange}
          style={{
            width: '100%',
            height: 'var(--control-height-md, 36px)',
            padding: leftIcon ? '0 12px 0 36px' : '0 12px',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-body-size)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 'var(--radius-sm, 6px)',
            background: 'var(--color-surface)',
            outline: 'none',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            ...style,
          }}
          className="focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20"
          {...props}
        />
      </div>
    </div>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  options: SelectOption[];
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

function Select({ label, options, onChange, style, ...props }: SelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      {label && (
        <label style={{ fontSize: 'var(--text-sm-size)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text)' }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', width: '100%' }}>
        <select
          onChange={onChange}
          style={{
            width: '100%',
            height: 'var(--control-height-md, 36px)',
            padding: '0 32px 0 12px',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-body-size)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 'var(--radius-sm, 6px)',
            background: 'var(--color-surface)',
            outline: 'none',
            appearance: 'none',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            ...style,
          }}
          className="focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20"
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>
    </div>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  iconLeft?: React.ReactNode;
}

function Button({ variant = 'primary', size = 'md', iconLeft, children, style, ...props }: ButtonProps) {
  const getStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      fontFamily: 'var(--font-sans)',
      fontWeight: 600,
      borderRadius: 'var(--radius-sm, 6px)',
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      opacity: props.disabled ? 0.5 : 1,
      transition: 'all 0.15s ease',
      outline: 'none',
      border: 'none',
    };

    const sizeStyles = size === 'sm'
      ? { height: '28px', fontSize: '12px', padding: '0 10px' }
      : { height: 'var(--control-height-md, 36px)', fontSize: '13px', padding: '0 14px' };

    let variantStyles: React.CSSProperties = {};
    if (variant === 'primary') {
      variantStyles = {
        background: 'var(--color-primary)',
        color: '#ffffff',
      };
    } else if (variant === 'secondary') {
      variantStyles = {
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border-strong)',
      };
    } else if (variant === 'ghost') {
      variantStyles = {
        background: 'transparent',
        color: 'var(--color-text-secondary)',
      };
    }

    return { ...base, ...sizeStyles, ...variantStyles, ...style };
  };

  const getClassName = () => {
    if (props.disabled) return '';
    if (variant === 'primary') return 'hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)]';
    if (variant === 'secondary') return 'hover:bg-[var(--color-surface-3)] active:bg-[var(--color-border)]';
    if (variant === 'ghost') return 'hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]';
    return '';
  };

  return (
    <button style={getStyles()} className={getClassName()} {...props}>
      {iconLeft && <span style={{ display: 'flex', alignItems: 'center' }}>{iconLeft}</span>}
      <span>{children}</span>
    </button>
  );
}

// ─────────────────────────────── SVG Helpers ─────────────────────────────────

function ic(paths: string | string[], size: number = 18) {
  const el = (d: string, i: number) => <path d={d} key={i} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {(Array.isArray(paths) ? paths : [paths]).map(el)}
    </svg>
  );
}

const icPublish = ic(['M5 12h14', 'M13 6l6 6-6 6'], 16);
const icSearch = ic(['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'm21 21-4.3-4.3'], 16);
const icPlus = ic(['M12 5v14', 'M5 12h14'], 16);

// ─────────────────────────────── Initial Seeding ───────────────────────────────

const DEFAULT_PROMOS = DEFAULT_KIOSK_PROMOS as Promotion[];
const DEFAULT_VIDEOS = DEFAULT_KIOSK_VIDEOS as Video[];
const DEFAULT_SETTINGS = DEFAULT_KIOSK_SETTINGS as KioskSettings;

const DEFAULT_LAST_PUBLISHED = {
  at: 'Today · 9:24 AM',
  by: 'A. Haddad',
};

// Initial published rotation. Subsequent changes are entirely publish-driven.
const defaultKioskMenuSettings = (items: MenuItem[]): KioskMenuItemSetting[] => {
  return createDefaultKioskMenuSettings(items) as KioskMenuItemSetting[];
};

// ──────────────────────────────── Component ──────────────────────────────────

export function KioskWindowManagementPage() {
  // ── Source data ──
  const storedCategories = load<Category[]>(SK.categories, []);
  const baseCategories = (SEED_CATEGORIES as Category[]).map((seedCategory) => {
    const stored = storedCategories.find(category => category.id === seedCategory.id);
    return stored
      ? { ...seedCategory, ...stored, subs: seedCategory.subs.length ? seedCategory.subs : stored.subs }
      : seedCategory;
  }).concat(storedCategories.filter(category => !SEED_CATEGORIES.some(seed => seed.id === category.id)));
  const storedMenuItems = load<MenuItem[]>(SK.items, []);
  const baseMenuItems = (SEED_ITEMS as MenuItem[]).map((seedItem) => {
    const stored = storedMenuItems.find(item => item.id === seedItem.id);
    return stored ? { ...seedItem, ...stored, imageUrl: stored.imageUrl || seedItem.imageUrl } : seedItem;
  }).concat(storedMenuItems.filter(item => !SEED_ITEMS.some(seed => seed.id === item.id)));

  // ── Kiosk Draft States ──
  const [kioskMenuSettings, setKioskMenuSettings] = useState<KioskMenuItemSetting[]>(() => {
    const stored = load<KioskMenuItemSetting[]>(SK.kioskMenuItems, []);
    return baseMenuItems.every(item => stored.some(setting => setting.id === item.id))
      ? stored
      : defaultKioskMenuSettings(baseMenuItems);
  });
  const [promos, setPromos] = useState<Promotion[]>(() => load<Promotion[]>(SK.kioskPromos, DEFAULT_PROMOS));
  const videos = DEFAULT_VIDEOS;
  const [settings, setSettings] = useState<KioskSettings>(() => load<KioskSettings>(SK.kioskSettings, DEFAULT_SETTINGS));

  // ── Active edit states ──
  const [tab, setTab] = useState<string>('menu');
  const [search, setSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [editingPromoId, setEditingPromoId] = useState<string | null>(() =>
    DEFAULT_PROMOS[0] ? DEFAULT_PROMOS[0].id : null
  );

  // ── Drag & drop states ──
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // ── Publish States ──
  const [publishedSnapshot, setPublishedSnapshot] = useState<string>(() => {
    const local = localStorage.getItem(SK.kioskPublishedSnapshot);
    if (local) {
      try {
        const previous = JSON.parse(local);
        const shouldInstallFeaturedDefaults = (previous.version || 0) < 5;
        const migrated = JSON.stringify({
          version: 5,
          // Categories/items always mirror the current canonical menu (shared/menu/menuData.mjs,
          // merged with any admin overrides via baseCategories/baseMenuItems above) rather than
          // whatever was frozen into a previously published snapshot, so a stale publish can never
          // keep serving old titles/images to the kiosk after the canonical menu changes.
          categories: baseCategories,
          menuItems: baseMenuItems,
          menuItemSettings: shouldInstallFeaturedDefaults
            ? defaultKioskMenuSettings(baseMenuItems)
            : (previous.menuItemSettings || defaultKioskMenuSettings(baseMenuItems)),
          promos: previous.promos || DEFAULT_PROMOS,
          videos: previous.videos || DEFAULT_VIDEOS,
          settings: previous.settings || DEFAULT_SETTINGS,
          branding: previous.branding || PUBLISHED_BRANDING,
          rotationStrategy: DEFAULT_KIOSK_ROTATION_STRATEGY,
          playlistTemplate: DEFAULT_KIOSK_PLAYLIST_TEMPLATE,
        });
        localStorage.setItem(SK.kioskPublishedSnapshot, migrated);
        return migrated;
      } catch {
        // Replace malformed legacy data with a complete publishable snapshot.
      }
    }
    const initial = JSON.stringify({
      version: 5,
      categories: baseCategories,
      menuItems: baseMenuItems,
      menuItemSettings: defaultKioskMenuSettings(baseMenuItems),
      promos: DEFAULT_PROMOS,
      videos: DEFAULT_VIDEOS,
      settings: DEFAULT_SETTINGS,
      branding: PUBLISHED_BRANDING,
      rotationStrategy: DEFAULT_KIOSK_ROTATION_STRATEGY,
      playlistTemplate: DEFAULT_KIOSK_PLAYLIST_TEMPLATE,
    });
    localStorage.setItem(SK.kioskPublishedSnapshot, initial);
    return initial;
  });
  const [lastPublished, setLastPublished] = useState(() =>
    load(SK.kioskLastPublished, DEFAULT_LAST_PUBLISHED)
  );

  // ── Live Preview Index ──
  const [pvIndex, setPvIndex] = useState<number>(0);

  // ── Toast Notifications ──
  const [toastMsg, setToastMsg] = useState<string>('');
  const [showToast, setShowToast] = useState<boolean>(false);

  // ── Refs ──
  const pvSlideRef = useRef<HTMLDivElement>(null);
  const pvKenRef = useRef<HTMLDivElement>(null);
  const pvDotsRef = useRef<HTMLDivElement>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  // ─────────────────────────────── Helper calculations ─────────────────────────

  // Merge base items with Kiosk specific settings (enabled state, custom badge, custom kioskSortOrder)
  const kioskMenu: KioskMenuItem[] = useMemo(() => {
    return (baseMenuItems || []).map((item) => {
      const kSetting = (kioskMenuSettings || []).find((x) => x.id === item.id) || {
        id: item.id,
        enabled: false,
        badge: '',
        kioskSortOrder: item.sortOrder,
      };
      const cat = (baseCategories || []).find((c) => c.id === item.categoryId);
      return {
        ...item,
        kioskEnabled: kSetting.enabled,
        kioskBadge: kSetting.badge,
        kioskSortOrder: kSetting.kioskSortOrder,
        categoryName: cat ? cat.name : 'Unknown',
      };
    }).sort(compareMenuItemsAlphabetically);
  }, [baseMenuItems, baseCategories, kioskMenuSettings]);

  // Filtered menu in the list
  const filteredMenu: KioskMenuItem[] = useMemo(() => {
    return kioskMenu.filter((m: KioskMenuItem) => {
      const q = search.trim().toLowerCase();
      const matchesCategory = categoryFilter === 'All' || m.categoryName === categoryFilter;
      const matchesSearch = !q || m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [kioskMenu, search, categoryFilter]);

  const enabledItemsCount = useMemo(() => kioskMenu.filter((m: KioskMenuItem) => m && m.kioskEnabled).length, [kioskMenu]);
  const enabledPromosCount = useMemo(() => (promos || []).filter((p: Promotion) => p && p.enabled).length, [promos]);

  const currentSnapshot = JSON.stringify({
    version: 5,
    categories: baseCategories,
    menuItems: baseMenuItems,
    menuItemSettings: kioskMenuSettings,
    promos,
    videos,
    settings,
    branding: PUBLISHED_BRANDING,
    rotationStrategy: DEFAULT_KIOSK_ROTATION_STRATEGY,
    playlistTemplate: DEFAULT_KIOSK_PLAYLIST_TEMPLATE,
  });

  const isDirty = currentSnapshot !== publishedSnapshot;

  // ─────────────────────────────── Effects ─────────────────────────────────────

  // Keep a cross-port, frontend-only copy available to the signage. Cookies are
  // shared by localhost ports, unlike localStorage, and the payload is compressed.
  useEffect(() => {
    void writePublishedConfigCookies(JSON.parse(publishedSnapshot)).catch(error => {
      console.error('Failed to expose published kiosk configuration', error);
    });
  }, [publishedSnapshot]);

  // Slide cycle trigger duration helper
  const pvInterval = useCallback(() => {
    const dur = Number(settings.slideDuration);
    return Math.max(2200, (isNaN(dur) ? 8 : dur) * 700);
  }, [settings.slideDuration]);

  const buildPreviewSlides = useCallback(() => {
    const enabledVideos = [...(videos || [])].filter((v: Video) => v && v.enabled).sort((a, b) => a.order - b.order);
    const enabledPromos = [...(promos || [])].filter((p: Promotion) => p && p.enabled).sort((a, b) => a.priority - b.priority);
    const enabledItems = (kioskMenu || []).filter((m: KioskMenuItem) => m && m.kioskEnabled);

    const out = [];
    out.push({
      kind: 'BRAND',
      label: 'Fresh Mediterranean',
      title: 'Fresh Mediterranean,\nover real charcoal.',
      kicker: 'Mediterranean Kitchen',
      text: 'Mezze · Grills · Sharing platters',
      price: '',
      badge: '',
      photo: 'radial-gradient(120% 90% at 70% 30%, #3a2a18, #0A0908)',
    });

    if (settings.rotateVideos) {
      enabledVideos.forEach((v) =>
        out.push({
          kind: 'VIDEO',
          label: v.name,
          title: v.name.replace(/ — .*/, ''),
          kicker: `Featured film · ${v.res}`,
          text: `${Math.round(v.durationSec)}s muted loop`,
          price: '',
          badge: 'Video',
          photo: 'linear-gradient(135deg,#1f2937,#0A0908)',
        })
      );
    }

    if (settings.rotatePromos) {
      enabledPromos.forEach((p) =>
        out.push({
          kind: 'PROMO',
          label: p.title,
          title: p.title,
          kicker: 'Promotion',
          text: p.text,
          price: '',
          badge: p.badge,
          photo: 'radial-gradient(120% 100% at 40% 40%, #2a1f14, #0A0908)',
        })
      );
    }

    if (settings.rotateMenu) {
      enabledItems.forEach((m: KioskMenuItem) =>
        out.push({
          kind: 'ITEM',
          label: m.title,
          title: m.title,
          kicker: m.categoryName,
          text: m.description,
          price: `$${m.price}`,
          badge: m.kioskBadge,
          photo: 'radial-gradient(120% 90% at 65% 35%, #34281a, #0A0908)',
        })
      );
    }

    out.push({
      kind: 'QR',
      label: 'Book a Table',
      title: 'Reserve your\ntable tonight.',
      kicker: 'Hungry? Step inside',
      text: 'Scan to book · verdura.co.nz/book.html',
      price: '',
      badge: '',
      photo: 'radial-gradient(120% 100% at 25% 40%, #2a2113, #0A0908)',
    });

    return out;
  }, [videos, promos, kioskMenu, settings.rotateVideos, settings.rotatePromos, settings.rotateMenu]);

  const slides = useMemo(() => buildPreviewSlides(), [buildPreviewSlides]);

  // Animation application helper
  const applyPvTransition = useCallback(() => {
    const map: Record<string, string> = {
      dissolve: 'pvFade .8s ease both',
      fade: 'pvFade .9s ease both',
      slide: 'pvSlide .7s cubic-bezier(.22,.61,.36,1) both',
      zoom: 'pvZoom .8s ease both',
    };
    requestAnimationFrame(() => {
      const node = pvSlideRef.current;
      const ken = pvKenRef.current;
      if (node) {
        const a = map[settings.transition] || map.dissolve;
        node.style.animation = 'none';
        void node.offsetWidth; // force reflow
        node.style.animation = a as string;
      }
      if (ken) {
        ken.style.animation = 'none';
        void ken.offsetWidth; // force reflow
        ken.style.animation = `pvKen ${pvInterval() / 1000 + 1}s ease-out both`;
      }
    });
  }, [settings.transition, pvInterval]);

  // Preview cycle timer management (using setInterval for steady, clean state updates)
  useEffect(() => {
    const intervalTime = pvInterval();
    const interval = setInterval(() => {
      setPvIndex((idx) => {
        const len = buildPreviewSlides().length;
        return len > 0 ? (idx + 1) % len : 0;
      });
    }, intervalTime);

    return () => clearInterval(interval);
  }, [buildPreviewSlides, pvInterval]);

  // Handle slide transitions visually when index changes
  useEffect(() => {
    applyPvTransition();
  }, [pvIndex, applyPvTransition]);

  // Auto reset pvIndex if it goes out of bounds when slide count changes
  useEffect(() => {
    const len = slides.length;
    if (pvIndex >= len) {
      setPvIndex(0);
    }
  }, [slides.length, pvIndex]);

  // Clean up toast timers
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  // ─────────────────────────────── Actions ─────────────────────────────────────

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setShowToast(true);
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => {
      setShowToast(false);
    }, 2400);
  };

  const handleSaveDraft = () => {
    save(SK.kioskMenuItems, kioskMenuSettings);
    save(SK.kioskPromos, promos);
    save(SK.kioskSettings, settings);
    triggerToast('Draft saved');
  };

  const handlePublish = async () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const formattedDate = `Today · ${timeStr}`;
    const publisherInfo = { at: formattedDate, by: 'A. Haddad' };

    save(SK.kioskMenuItems, kioskMenuSettings);
    save(SK.kioskPromos, promos);
    save(SK.kioskSettings, settings);
    save(SK.kioskPublishedSnapshot, currentSnapshot);
    save(SK.kioskLastPublished, publisherInfo);
    try {
      await writePublishedConfigCookies(JSON.parse(currentSnapshot));
    } catch (error) {
      console.error('Failed to synchronize published kiosk configuration', error);
    }

    setPublishedSnapshot(currentSnapshot);
    setLastPublished(publisherInfo);
    triggerToast('Published to 20 kiosk displays');
  };

  const handleRevert = () => {
    if (!isDirty) return;
    try {
      const p = JSON.parse(publishedSnapshot);
      setKioskMenuSettings(p.menuItemSettings);
      setPromos(p.promos);
      setSettings(p.settings);
      setEditingPromoId(p.promos[0] ? p.promos[0].id : null);
      triggerToast('Reverted to last published version');
    } catch (e) {
      console.error('Failed to parse published snapshot', e);
    }
  };

  // Menu items toggling
  const handleToggleMenuItem = (itemId: string) => {
    setKioskMenuSettings((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, enabled: !item.enabled } : item))
    );
  };

  // Reorder items on drag & drop
  const handleReorderMenuItems = (srcId: string, dstId: string) => {
    if (!srcId || srcId === dstId) return;
    const itemsCopy = [...kioskMenuSettings];
    const fromIndex = itemsCopy.findIndex((x) => x.id === srcId);
    const toIndex = itemsCopy.findIndex((x) => x.id === dstId);
    if (fromIndex < 0 || toIndex < 0) return;

    // Splice and swap
    const targets = itemsCopy.splice(fromIndex, 1);
    if (targets[0]) {
      itemsCopy.splice(toIndex, 0, targets[0]);
    }

    // Reassign sort orders based on index in array
    const updatedSettings = itemsCopy.map((item, idx) => ({
      ...item,
      kioskSortOrder: idx,
    }));

    setKioskMenuSettings(updatedSettings);
    setDragId(null);
    setOverId(null);
  };

  // Promotions management
  const handleTogglePromo = (id: string) => {
    setPromos((prev) => prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)));
  };

  const handleEditPromoField = (field: keyof Promotion, val: any) => {
    setPromos((prev) => prev.map((p) => (p.id === editingPromoId ? { ...p, [field]: val } : p)));
  };

  const handleAddPromo = () => {
    const id = `p_${Date.now()}`;
    const newPromo: Promotion = {
      id,
      title: 'New promotion',
      badge: 'New',
      text: 'Describe this offer…',
      priority: promos.length + 1,
      start: '2026-07-01',
      end: '2026-07-31',
      enabled: false,
    };
    setPromos((prev) => [...prev, newPromo]);
    setEditingPromoId(id);
  };

  const handleDeletePromo = () => {
    if (!editingPromoId) return;
    setPromos((prev) => {
      const filtered = prev.filter((p) => p.id !== editingPromoId);
      setEditingPromoId(filtered[0] ? filtered[0].id : null);
      return filtered;
    });
  };



  // Settings management
  const handleSetSetting = (field: keyof KioskSettings, val: any) => {
    setSettings((prev) => ({ ...prev, [field]: val }));
  };

  // ─────────────────────────────── Rendering Setup ─────────────────────────────

  const curSlide = slides[pvIndex % slides.length] || {
    kind: 'BRAND',
    label: 'Fresh Mediterranean',
    title: 'Fresh Mediterranean,\nover real charcoal.',
    kicker: 'Mediterranean Kitchen',
    text: 'Mezze · Grills · Sharing platters',
    price: '',
    badge: '',
    photo: 'radial-gradient(120% 90% at 70% 30%, #3a2a18, #0A0908)',
  };

  const kindColors: Record<string, string> = {
    BRAND: 'var(--color-text-tertiary)',
    VIDEO: 'var(--color-accent)',
    PROMO: 'var(--color-warning)',
    ITEM: 'var(--color-primary)',
    QR: 'var(--color-info)',
  };

  const badgeTones: Record<string, any> = {
    'Best Seller': 'warning',
    'New': 'info',
    'Limited': 'danger',
    'Limited Time': 'danger',
    'Chef Special': 'accent',
    "Chef's Choice": 'accent',
    'Popular': 'primary',
  };

  const getBadgeTone = (b: string) => badgeTones[b] || 'neutral';

  const categoryChips = ['All', 'Temptation', 'The Feast', 'Sides', 'Drinks'].map((c) => {
    const isActive = c === categoryFilter;
    return {
      label: c,
      style: {
        height: '30px',
        padding: '0 13px',
        borderRadius: '99px',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm-size)',
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap' as const,
        transition: 'all .15s ease',
        background: isActive ? 'var(--color-primary)' : 'var(--color-surface)',
        color: isActive ? '#fff' : 'var(--color-text-secondary)',
        border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--color-border-strong)',
        outline: 'none',
      },
      onClick: () => setCategoryFilter(c),
    };
  });

  const editingPromo = promos.find((p) => p.id === editingPromoId) || {
    title: '',
    badge: 'New',
    text: '',
    priority: 1,
    start: '',
    end: '',
    enabled: false,
  };

  const transitionOptions = [
    { value: 'dissolve', label: 'Cross dissolve' },
    { value: 'fade', label: 'Fade' },
    { value: 'slide', label: 'Slide' },
    { value: 'zoom', label: 'Ken Burns zoom' },
  ];

  const playlistOptions = ['Standard', 'Breakfast', 'Lunch', 'Dinner', 'Late Night', 'Weekend', 'Festive'].map(
    (x) => ({ value: x, label: x })
  );

  const playlistNames = ['Breakfast', 'Lunch', 'Dinner', 'Weekend', 'Festive', 'Valentine’s'];

  const getPChipStyle = (active: boolean): React.CSSProperties => ({
    height: '26px',
    padding: '0 11px',
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: '99px',
    fontSize: 'var(--text-xs-size)',
    fontWeight: 500,
    background: active ? 'var(--color-primary-subtle)' : 'var(--color-surface-2)',
    color: active ? 'var(--green-700)' : 'var(--color-text-tertiary)',
    border: active ? '1px solid var(--color-success-border)' : '1px solid var(--color-border)',
  });

  const activeTransLabel = transitionOptions.find((t) => t.value === settings.transition)?.label || 'Cross dissolve';

  const menuRowsText = `${filteredMenu.length} shown · ${enabledItemsCount} on window`;
  const promosText = `${enabledPromosCount} of ${promos.length} promotions active`;

  // Duration metrics helper
  const loopSec = slides.length * settings.slideDuration;
  const loopMins = Math.floor(loopSec / 60);
  const loopRemainingSecs = loopSec % 60;
  const loopLengthStr = `${loopMins}:${String(loopRemainingSecs).padStart(2, '0')}`;

  const stats = [
    { label: 'Items on window', value: String(enabledItemsCount), unit: `of ${baseMenuItems.length}` },
    { label: 'Active promotions', value: String(enabledPromosCount), unit: 'live' },
    { label: 'Loop length', value: loopLengthStr, unit: 'approx' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pvFade { from { transform: scale(1.015); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes pvSlide { from { transform: translateX(28px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes pvZoom { from { transform: scale(1.06); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes pvKen { from { transform: scale(1.02) } to { transform: scale(1.13) } }
        @keyframes dotPulse { 0%, 100% { opacity: 1 } 50% { opacity: .4 } }
        .kwm-row { transition: background var(--duration-fast) var(--ease-in-out), border-color var(--duration-fast) var(--ease-in-out); }
        .kwm-row:hover { background: var(--color-surface-2); }
      ` }} />

      {/* ──────────────── PUBLISH STRIP ──────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '11px 24px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <span
            style={{
              width: '9px',
              height: '9px',
              borderRadius: '99px',
              flexShrink: 0,
              background: isDirty ? 'var(--color-warning)' : 'var(--color-success)',
              boxShadow: isDirty ? '0 0 0 3px var(--color-warning-bg)' : '0 0 0 3px var(--color-success-bg)',
              transition: 'all 0.15s ease',
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-sm-size)', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
              {isDirty ? 'Unsaved draft changes' : 'All changes published'}
            </div>
            <div style={{ fontSize: 'var(--text-xs-size)', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', marginTop: '1px' }}>
              Last published {lastPublished.at} · by {lastPublished.by}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <Button variant="ghost" size="sm" disabled={!isDirty} onClick={handleRevert}>
            Revert to published
          </Button>
          <Button variant="secondary" size="sm" onClick={handleSaveDraft}>
            Save draft
          </Button>
          <Button variant="primary" size="sm" disabled={!isDirty} onClick={handlePublish} iconLeft={icPublish}>
            Publish changes
          </Button>
        </div>
      </div>

      {/* ──────────────── CONTENT + PREVIEW SPLIT ──────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT COLUMN: EDITOR */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Stat Tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', padding: '20px 24px 0' }}>
            {stats.map((st, i) => (
              <div key={i} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', boxShadow: 'var(--shadow-xs)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', color: 'var(--color-text-tertiary)' }}>
                  {st.label}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '7px' }}>
                  <div style={{ fontSize: '26px', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {st.value}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs-size)', color: 'var(--color-text-secondary)' }}>
                    {st.unit}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Tabs header */}
          <div style={{ padding: '18px 24px 0' }}>
            <Tabs
              tabs={[
                { key: 'menu', label: 'Menu Items', badge: enabledItemsCount },
                { key: 'promos', label: 'Promotions', badge: enabledPromosCount },
                { key: 'settings', label: 'Display Settings' },
              ]}
              active={tab}
              onChange={setTab}
            />
          </div>

          {/* Inner scrolling editor panel */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 40px' }}>

            {/* TAB: MENU ITEMS */}
            {tab === 'menu' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  <div style={{ width: '280px' }}>
                    <Input
                      placeholder="Search dishes…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      leftIcon={icSearch}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {categoryChips.map((chip, idx) => (
                      <button key={idx} type="button" onClick={chip.onClick} style={chip.style}>
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: 'var(--text-sm-size)', color: 'var(--color-text-secondary)' }}>
                    {menuRowsText}
                  </div>
                </div>

                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-xs)' }}>
                  {/* Table Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 16px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', color: 'var(--color-text-tertiary)' }}>
                    <span style={{ width: '18px' }} />
                    <span style={{ flex: 1 }}>Dish</span>
                    <span style={{ width: '160px' }}>Category</span>
                    <span style={{ width: '90px', textAlign: 'right' }}>Price</span>
                    <span style={{ width: '120px', textAlign: 'center' }}>On window</span>
                  </div>

                  {/* List Rows */}
                  {filteredMenu.map((row: KioskMenuItem) => {
                    const isDraggingThis = dragId === row.id;
                    const isDraggedOver = overId === row.id;
                    const tags = row.nutritionalDetails?.tags ?? [];

                    return (
                      <div
                        key={row.id}
                        className="kwm-row"
                        draggable
                        onDragStart={(e) => {
                          try {
                            e.dataTransfer.effectAllowed = 'move';
                          } catch {
                            // ignore
                          }
                          setDragId(row.id);
                        }}
                        onDragEnter={() => {
                          if (dragId && dragId !== row.id) setOverId(row.id);
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragId) handleReorderMenuItems(dragId, row.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverId(null);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '14px',
                          padding: '11px 16px',
                          borderBottom: '1px solid var(--color-border)',
                          cursor: 'default',
                          opacity: isDraggingThis ? 0.45 : 1,
                          background: isDraggedOver ? 'var(--color-primary-subtle)' : undefined,
                          boxShadow: isDraggedOver ? 'inset 0 2px 0 var(--color-primary)' : undefined,
                        }}
                      >
                        {/* Grab Handle */}
                        <span style={{ width: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', cursor: 'grab' }} title="Drag to reorder">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <circle cx="9" cy="6" r="1" />
                            <circle cx="15" cy="6" r="1" />
                            <circle cx="9" cy="12" r="1" />
                            <circle cx="15" cy="12" r="1" />
                            <circle cx="9" cy="18" r="1" />
                            <circle cx="15" cy="18" r="1" />
                          </svg>
                        </span>

                        {/* Image / Thumbnail placeholder */}
                        <div style={{ width: '46px', height: '46px', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg,var(--gray-200),var(--gray-100))', border: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', overflow: 'hidden' }}>
                          {row.imageUrl ? (
                            <img src={row.imageUrl} alt={row.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 11h18M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
                              <path d="M5 11l1 9h12l1-9" />
                            </svg>
                          )}
                        </div>

                        {/* Text description */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {row.title}
                            </span>
                            {row.kioskBadge ? (
                              <Badge tone={getBadgeTone(row.kioskBadge)} variant="soft" size="sm">
                                {row.kioskBadge}
                              </Badge>
                            ) : null}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                            <span style={{ fontSize: 'var(--text-xs-size)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '340px' }}>
                              {row.description}
                            </span>
                             {tags.map((t: string) => (
                              <span key={t} style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '1px 5px' }}>
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Category */}
                        <span style={{ width: '160px', fontSize: 'var(--text-sm-size)', color: 'var(--color-text-secondary)' }}>
                          {row.categoryName}
                          {row.subCategory && (
                            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
                              {row.subCategory}
                            </div>
                          )}
                        </span>

                        {/* Price */}
                        <span style={{ width: '90px', textAlign: 'right', fontSize: 'var(--text-body-size)', fontWeight: 600, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
                          ${row.price}
                        </span>

                        {/* Enable toggle */}
                        <span style={{ width: '120px', display: 'flex', justifyContent: 'center' }}>
                          <Switch checked={row.kioskEnabled} onChange={() => handleToggleMenuItem(row.id)} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB: PROMOTIONS */}
            {tab === 'promos' && (
              <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 'var(--text-sm-size)', color: 'var(--color-text-secondary)' }}>
                      {promosText}
                    </div>
                    <Button variant="secondary" size="sm" onClick={handleAddPromo} iconLeft={icPlus}>
                      New promotion
                    </Button>
                  </div>

                  {promos.map((p) => {
                    const isSelected = p.id === editingPromoId;
                    return (
                      <div
                        key={p.id}
                        onClick={() => setEditingPromoId(p.id)}
                        style={{
                          background: 'var(--color-surface)',
                          border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          borderRadius: 'var(--radius-lg)',
                          boxShadow: isSelected ? '0 0 0 3px var(--color-primary-subtle)' : 'var(--shadow-xs)',
                          padding: '14px 16px',
                          cursor: 'pointer',
                          transition: 'border-color .15s ease, box-shadow .15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                          <div
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '99px',
                              marginTop: '7px',
                              flexShrink: 0,
                              background: p.enabled ? 'var(--color-success)' : 'var(--color-border-strong)',
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 600, color: 'var(--color-text)' }}>
                                {p.title}
                              </span>
                              {p.badge ? (
                                <Badge tone={getBadgeTone(p.badge)} variant="soft" size="sm">
                                  {p.badge}
                                </Badge>
                              ) : null}
                              <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                                Priority {p.priority}
                              </span>
                            </div>
                            <div style={{ fontSize: 'var(--text-sm-size)', color: 'var(--color-text-secondary)', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '520px' }}>
                              {p.text}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '6px' }}>
                              Active {p.start} → {p.end}
                            </div>
                          </div>
                          <span style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                            <Switch checked={p.enabled} onChange={() => handleTogglePromo(p.id)} />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Editor Panel on the right side of tab */}
                <div style={{ width: '360px', flexShrink: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)', padding: '18px' }}>
                  {editingPromoId ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ fontSize: 'var(--text-h3-size)', fontWeight: 600, color: 'var(--color-text)' }}>
                        Edit promotion
                      </div>
                      <Input
                        label="Promotion title"
                        value={editingPromo.title}
                        onChange={(e) => handleEditPromoField('title', e.target.value)}
                      />
                      <Select
                        label="Badge"
                        value={editingPromo.badge}
                        options={['New', 'Best Seller', 'Popular', 'Limited Time', "Chef's Choice", 'Spicy'].map((x) => ({ value: x, label: x }))}
                        onChange={(e) => handleEditPromoField('badge', e.target.value)}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: 'var(--text-sm-size)', fontWeight: 500, color: 'var(--color-text)' }}>
                          Promotional text
                        </label>
                        <textarea
                          value={editingPromo.text}
                          onChange={(e) => handleEditPromoField('text', e.target.value)}
                          rows={3}
                          style={{
                            width: '100%',
                            resize: 'vertical',
                            fontFamily: 'var(--font-sans)',
                            fontSize: 'var(--text-body-size)',
                            color: 'var(--color-text)',
                            padding: '9px 12px',
                            border: '1px solid var(--color-border-strong)',
                            borderRadius: 'var(--radius-sm)',
                            outline: 'none',
                            background: 'var(--color-surface)',
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <Input
                          label="Priority"
                          type="number"
                          value={editingPromo.priority}
                          onChange={(e) => handleEditPromoField('priority', parseInt(e.target.value) || 1)}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <Input
                          label="Starts"
                          type="date"
                          value={editingPromo.start}
                          onChange={(e) => handleEditPromoField('start', e.target.value)}
                        />
                        <Input
                          label="Ends"
                          type="date"
                          value={editingPromo.end}
                          onChange={(e) => handleEditPromoField('end', e.target.value)}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid var(--color-border)' }}>
                        <Switch
                          checked={editingPromo.enabled}
                          onChange={(val) => handleEditPromoField('enabled', val)}
                          label="Enabled"
                        />
                        <Button variant="ghost" size="sm" onClick={handleDeletePromo}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '40px 12px', color: 'var(--color-text-tertiary)' }}>
                      <div style={{ width: '44px', height: '44px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 5l4 4M3 21l1-4 11-11 3 3-11 11-4 1Z" />
                        </svg>
                      </div>
                      <div style={{ fontSize: 'var(--text-body-size)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                        Select a promotion to edit
                      </div>
                      <div style={{ fontSize: 'var(--text-sm-size)', marginTop: '4px' }}>
                        Its headline, badge, schedule and priority appear here.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}



            {/* TAB: DISPLAY SETTINGS */}
            {tab === 'settings' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '18px', maxWidth: '880px' }}>

                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)', padding: '20px' }}>
                  <div style={{ fontSize: 'var(--text-h3-size)', fontWeight: 600, color: 'var(--color-text)', marginBottom: '4px' }}>
                    Carousel timing
                  </div>
                  <div style={{ fontSize: 'var(--text-sm-size)', color: 'var(--color-text-secondary)', marginBottom: '18px' }}>
                    How long each image slide holds before advancing.
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label style={{ fontSize: 'var(--text-sm-size)', fontWeight: 500, color: 'var(--color-text)' }}>
                      Slide duration
                    </label>
                    <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 600, color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {settings.slideDuration}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="15"
                    step="1"
                    value={settings.slideDuration}
                    onChange={(e) => handleSetSetting('slideDuration', parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                    <span>4s</span>
                    <span>15s</span>
                  </div>
                  <div style={{ marginTop: '18px' }}>
                    <Select
                      label="Transition effect"
                      value={settings.transition}
                      options={transitionOptions}
                      onChange={(e) => handleSetSetting('transition', e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)', padding: '20px' }}>
                  <div style={{ fontSize: 'var(--text-h3-size)', fontWeight: 600, color: 'var(--color-text)', marginBottom: '4px' }}>
                    Auto-rotation
                  </div>
                  <div style={{ fontSize: 'var(--text-sm-size)', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                    Which content types cycle on the window.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid var(--color-border)' }}>
                      <div>
                        <div style={{ fontSize: 'var(--text-body-size)', fontWeight: 500, color: 'var(--color-text)' }}>
                          Featured menu items
                        </div>
                        <div style={{ fontSize: 'var(--text-xs-size)', color: 'var(--color-text-secondary)' }}>
                          Dishes toggled on in Menu Items
                        </div>
                      </div>
                      <Switch checked={settings.rotateMenu} onChange={(val) => handleSetSetting('rotateMenu', val)} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0' }}>
                      <div>
                        <div style={{ fontSize: 'var(--text-body-size)', fontWeight: 500, color: 'var(--color-text)' }}>
                          Promotions
                        </div>
                        <div style={{ fontSize: 'var(--text-xs-size)', color: 'var(--color-text-secondary)' }}>
                          Active campaign banners
                        </div>
                      </div>
                      <Switch checked={settings.rotatePromos} onChange={(val) => handleSetSetting('rotatePromos', val)} />
                    </div>
                  </div>
                </div>

                <div style={{ gridColumn: '1 / -1', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)', padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
                    <div>
                      <div style={{ fontSize: 'var(--text-h3-size)', fontWeight: 600, color: 'var(--color-text)', marginBottom: '4px' }}>
                        Scheduled &amp; seasonal content
                      </div>
                      <div style={{ fontSize: 'var(--text-sm-size)', color: 'var(--color-text-secondary)' }}>
                        Swap the active playlist by daypart or campaign — without touching the layout.
                      </div>
                    </div>
                    <Switch
                      checked={settings.scheduleEnabled}
                      onChange={(val) => handleSetSetting('scheduleEnabled', val)}
                      label="Enabled"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '14px', marginTop: '16px', alignItems: 'flex-end' }}>
                    <div style={{ width: '240px' }}>
                      <Select
                        label="Active playlist"
                        value={settings.playlist}
                        options={playlistOptions}
                        onChange={(e) => handleSetSetting('playlist', e.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', paddingBottom: '7px' }}>
                      {playlistNames.map((n) => (
                        <span key={n} style={getPChipStyle(settings.scheduleEnabled && n === settings.playlist)}>
                          {n}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            )}

          </div>
        </div>

        {/* RIGHT COLUMN: LIVE PREVIEW */}
        <div style={{ width: '520px', flexShrink: 0, borderLeft: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '99px', background: 'var(--color-danger)', animation: 'dotPulse 1.6s ease-in-out infinite' }} />
              <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 600, color: 'var(--color-text)' }}>
                Live preview
              </span>
            </div>
            <span style={{ fontSize: 'var(--text-xs-size)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              1920 × 1080
            </span>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* The Kiosk Frame container */}
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', flexShrink: 0, borderRadius: '12px', overflow: 'hidden', background: '#0A0908', boxShadow: '0 10px 40px rgba(0,0,0,.28)', border: '1px solid #000' }}>
              <div ref={pvSlideRef} style={{ position: 'absolute', inset: 0, opacity: 1 }}>
                <div ref={pvKenRef} style={{ position: 'absolute', inset: 0, background: curSlide.photo }} />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(8,7,6,.55) 0%, transparent 32%, transparent 50%, rgba(8,7,6,.92) 100%)' }} />

                {/* Kiosk top header */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 600, letterSpacing: '.34em', color: '#F7F2E8', fontSize: '15px', paddingLeft: '.34em' }}>
                    VERDURA
                  </div>
                  <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: '#E8CE86' }}>
                    {settings.scheduleEnabled ? `${settings.playlist.toUpperCase()} MENU` : 'NOW SERVING'}
                  </div>
                </div>

                {/* Kiosk body details */}
                <div style={{ position: 'absolute', left: '24px', right: '24px', bottom: '42px' }}>
                  {curSlide.badge ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: '99px', background: '#C6A152', color: '#1A1407', fontSize: '10px', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                      {curSlide.badge}
                    </span>
                  ) : null}
                  <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.22em', textTransform: 'uppercase', color: '#C6A152', marginTop: curSlide.badge ? '10px' : '0px' }}>
                    {curSlide.kicker}
                  </div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, color: '#F7F2E8', fontSize: '34px', lineHeight: 1.04, marginTop: '6px', whiteSpace: 'pre-line' }}>
                    {curSlide.title}
                  </div>
                  <div style={{ fontSize: '13px', color: '#C4BBAA', marginTop: '8px', maxWidth: '70%', lineHeight: 1.4 }}>
                    {curSlide.text}
                  </div>
                  {curSlide.price ? (
                    <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, color: '#E8CE86', fontSize: '28px', marginTop: '10px' }}>
                      {curSlide.price}
                    </div>
                  ) : null}
                </div>

                {/* Kiosk footer links */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#C6A152' }}>
                    View Menu
                  </span>
                  <div ref={pvDotsRef} style={{ display: 'flex', gap: '5px' }}>
                    {slides.map((_: any, i: number) => {
                      const on = i === (pvIndex % slides.length);
                      return (
                        <span
                          key={i}
                          style={{
                            width: on ? '14px' : '5px',
                            height: '5px',
                            borderRadius: '99px',
                            background: on ? '#C6A152' : 'rgba(255,255,255,.22)',
                            transition: 'all .4s ease',
                          }}
                        />
                      );
                    })}
                  </div>
                  <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#1A1407', background: '#C6A152', padding: '4px 10px', borderRadius: '99px' }}>
                    Book a Table
                  </span>
                </div>
              </div>
            </div>

            {/* Preview summary stats */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: 'var(--text-xs-size)', color: 'var(--color-text-secondary)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '99px', background: 'var(--color-primary)' }} />
                {slides.length} slides in rotation
              </span>
              <span>·</span>
              <span>
                {settings.slideDuration}s · {activeTransLabel}
              </span>
            </div>

            {/* Playlist Order Card */}
            <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', color: 'var(--color-text-tertiary)', marginBottom: '10px' }}>
                Playlist order
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '200px', overflowY: 'auto' }}>
                {slides.map((sl: any, i: number) => {
                  const isActiveSlide = i === (pvIndex % slides.length);
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '7px 8px',
                        borderRadius: 'var(--radius-sm)',
                        background: isActiveSlide ? 'var(--color-surface-3)' : 'transparent',
                      }}
                    >
                      <span style={{ width: '18px', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span style={{ width: '54px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: kindColors[sl.kind] || 'var(--color-text-tertiary)' }}>
                        {sl.kind}
                      </span>
                      <span style={{ flex: 1, fontSize: 'var(--text-sm-size)', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {sl.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ──────────────── TOAST NOTIFICATION ──────────────── */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: `translateX(-50%) translateY(${showToast ? '0' : '20px'})`,
          opacity: showToast ? 1 : 0,
          pointerEvents: 'none',
          transition: 'opacity .3s ease, transform .3s ease',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 18px',
          background: 'var(--gray-900)',
          color: '#fff',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)',
          fontSize: 'var(--text-body-size)',
          fontWeight: 500,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green-400)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <span>{toastMsg}</span>
      </div>

    </div>
  );
}
