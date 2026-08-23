import { useState, useEffect, useRef } from 'react';
import {
  CakeSlice,
  ConciergeBell,
  CookingPot,
  FlameKindling,
  Salad,
  Sandwich,
  Soup,
  Users,
  UsersRound,
  Utensils,
  UtensilsCrossed,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import SectionDivider from '../components/SectionDivider';
import DishModal from '../components/DishModal';
import DrinksMenu from '../components/DrinksMenu';
import { ASSETS } from '@/assets/index.js';

const HERO_IMG = ASSETS.hero.menu;

import { getAuthoritativeMenu } from '../shared/menu/menuClient.js';
import { sortMenuItemsAlphabetically } from '../shared/menu/menuData.js';
import { MENU_IMAGE_FALLBACK_SRC, handleMenuImageError } from '../../../../shared/media/menuImageFallback.mjs';

function getCatType(catName) {
  const n = catName.toLowerCase();
  if (n.includes('temptation')) return 'temptations';
  if (n.includes('feast')) return 'feast';
  if (n.includes('drink') || n.includes('beverage')) return 'drinks';
  return 'other';
}

// Keyed by category name rather than id: the live backend assigns real
// database UUIDs to categories (not the static seed's `cat-*` slugs), and
// names are what stay stable across a reseed.
const CATEGORY_ICONS = {
  'To Share': UsersRound,
  'Small Plates': Soup,
  'Salads': Salad,
  'Traditional Mediterranean Kebabs': UtensilsCrossed,
  'Mains': ConciergeBell,
  'Verdura Sharing Feasts': Users,
  'Fresh From The Oven': FlameKindling,
  'Burgers & Pasta': Sandwich,
  'Sides': CookingPot,
  'Desserts': CakeSlice,
};

export function ItemGrid({ items, onItemClick, isKiosk }) {
  if (isKiosk) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map(item => (
          <div
            key={item.id}
            onClick={() => onItemClick(item)}
            className="kiosk-menu-card group relative aspect-[4/3] rounded-[var(--radius-card)] overflow-hidden cursor-pointer"
          >
            <img
              src={item.image_url || MENU_IMAGE_FALLBACK_SRC}
              alt={item.name}
              onError={(e) => handleMenuImageError(e, item.name)}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="kiosk-menu-card-overlay absolute inset-0 pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
              <h3 className="font-body text-lg font-semibold leading-tight text-white tracking-normal line-clamp-2 flex-1 min-w-0">
                {item.name.toUpperCase()}
              </h3>
              <span className="font-body text-lg font-bold text-white tracking-normal flex-shrink-0">${item.price}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Mirrors the kiosk branch's card design above (image-forward tile with a
  // bottom text scrim) so Customer Website's /menu cards match the Window
  // Display reference — see docs on this parity work. Kept as a separate
  // branch rather than merged with the kiosk one so window-display's
  // isKiosk===true render path stays byte-for-byte unchanged.
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {items.map(item => (
        <div
          key={item.id}
          role="button"
          tabIndex={0}
          onClick={() => onItemClick(item)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onItemClick(item);
            }
          }}
          aria-label={`${item.name} — $${item.price}`}
          className="menu-card group relative aspect-[4/3] rounded-[var(--radius-card)] overflow-hidden cursor-pointer"
        >
          <img
            src={item.image_url || MENU_IMAGE_FALLBACK_SRC}
            alt={item.name}
            onError={(e) => handleMenuImageError(e, item.name)}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="menu-card-overlay absolute inset-0 pointer-events-none bg-[linear-gradient(to_bottom,transparent_40%,rgba(0,0,0,0.35)_65%,rgba(0,0,0,0.85)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
            <h3 className="font-body text-lg font-semibold leading-tight text-white tracking-normal line-clamp-2 flex-1 min-w-0">
              {item.name.toUpperCase()}
            </h3>
            <span className="font-body text-lg font-bold text-white tracking-normal flex-shrink-0">${item.price}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Kiosk mode check mirrors Navbar.jsx: window-display aliases this exact page
// from customer-website and runs on a fixed dev/prod port (5174), so this is
// the established way shared pages tell the two contexts apart.
const isKioskMode = () => typeof window !== 'undefined' && window.location.port === '5174';

export default function Menu() {
  const isKiosk = isKioskMode();
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeSubCategory, setActiveSubCategory] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const scrollRef = useRef(0);

  useEffect(() => {
    document.title = 'Menu — Verdura';
    const desc = "Explore Verdura's seasonal menu — thoughtfully crafted dishes made from the finest local ingredients. Filter by course and dietary preference.";
    document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', desc);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', desc);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', 'Menu — Verdura');
  }, []);

  useEffect(() => {
    async function loadMenu() {
      try {
        const data = await getAuthoritativeMenu();
        setCategories(data.categories);
        setItems(data.items);
        setError(null);
        if (data.categories.length > 0) {
          const firstCat = data.categories[0];
          setActiveCategory(firstCat.id);
          const subCats = firstCat.subs ? firstCat.subs.map(s => s.name) : [];
          if (subCats.length > 0) {
            setActiveSubCategory(subCats[0]);
          } else {
            setActiveSubCategory(null);
          }
        }
      } catch (err) {
        console.error("Failed to load authoritative menu data", err);
        // Show an honest error state — never fall back to stale/fake data.
        setError('The menu is temporarily unavailable. Please try again shortly.');
      } finally {
        setLoading(false);
      }
    }
    loadMenu();
  }, []);

  function handleItemClick(item) {
    scrollRef.current = window.scrollY;
    setSelectedItem(item);
  }

  function handleModalClose() {
    setSelectedItem(null);
    requestAnimationFrame(() => window.scrollTo(0, scrollRef.current));
  }

  function handleCategoryClick(cat) {
    setActiveCategory(cat.id);
    const subCats = cat.subs ? cat.subs.map(s => s.name) : [];
    if (subCats.length > 0) {
      setActiveSubCategory(subCats[0]);
    } else {
      setActiveSubCategory(null);
    }
  }

  return (
    <div className={`min-h-screen bg-background${isKiosk ? ' kiosk-menu-shell' : ''}`}>
      <Navbar />
      <div className={`grid grid-cols-1 lg:grid-cols-[320px_1fr] min-h-screen overflow-hidden${isKiosk ? ' kiosk-menu-grid' : ''}`}>
        {/* Left hero */}
        <div className={`relative h-[50vh] lg:h-screen lg:sticky lg:top-0${isKiosk ? ' kiosk-menu-hero' : ''}`}>
          <img src={HERO_IMG} alt="Menu" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <h1 className="absolute bottom-8 left-8 font-display text-5xl md:text-7xl text-foreground tracking-tight">
            MENU
          </h1>
        </div>

        {/* Menu content — the sole vertical scroll owner in kiosk mode */}
        <div className={`px-4 md:px-8 py-8 lg:pt-24 min-w-0 overflow-hidden${isKiosk ? ' kiosk-menu-content' : ''}`}>
          {loading ? (
            <div className="flex items-center justify-center min-h-[300px]">
              <div className="animate-spin h-8 w-8 text-accent rounded-full border-2 border-accent border-t-transparent" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center min-h-[300px] text-center text-muted-foreground font-body text-sm">
              {error}
            </div>
          ) : (
            <>
              {/* Category tabs */}
              <div className={`sticky top-0 bg-background/95 backdrop-blur-sm z-10 pt-4 pb-2 mb-8${isKiosk ? ' kiosk-menu-header' : ''}`}>
                <nav className="menu-category-nav" aria-label="Menu categories">
                  <div className="menu-category-list">
                    {categories.map(cat => {
                      const CategoryIcon = CATEGORY_ICONS[cat.name] || Utensils;
                      const isActive = activeCategory === cat.id;
                      const sizeClass = cat.name.length > 24
                        ? ' menu-category-tab--long'
                        : cat.name.length > 14
                          ? ' menu-category-tab--medium'
                          : '';

                      return (
                        <button
                          key={cat.id}
                          onClick={() => handleCategoryClick(cat)}
                          aria-current={isActive ? 'page' : undefined}
                          className={`menu-category-tab${sizeClass}${isActive ? ' menu-category-tab--active' : ''}`}
                        >
                          <CategoryIcon className="menu-category-icon" aria-hidden="true" />
                          <span className="menu-category-label">{cat.name.toUpperCase()}</span>
                        </button>
                      );
                    })}
                  </div>
                </nav>
              </div>

              <>
                {categories.filter(c => !activeCategory || c.id === activeCategory).map(cat => {
                  const catType = getCatType(cat.name);
                  const subCats = cat.subs ? cat.subs.map(s => s.name) : [];
                  const hasSubs = subCats.length > 0;
                  const catItems = (hasSubs && activeSubCategory
                    ? items.filter(i => i.category_id === cat.id && i.sub_category === activeSubCategory)
                    : items.filter(i => i.category_id === cat.id)
                  );
                  const sortedCatItems = sortMenuItemsAlphabetically(catItems);

                  return (
                    <div key={cat.id} className="mb-12">
                      <SectionDivider title={cat.name.toUpperCase()} />

                      {catType === 'drinks' ? (
                        <DrinksMenu items={items.filter(i => i.category_id === cat.id)} />
                      ) : (
                        <>
                          {hasSubs && (
                            <div className="flex justify-center gap-6 mb-8 overflow-x-auto">
                              {subCats.map(sub => (
                                <button
                                  key={sub}
                                  onClick={() => setActiveSubCategory(sub)}
                                  className={`text-base font-medium tracking-normal font-body whitespace-nowrap pb-1.5 border-b transition-colors ${
                                    activeSubCategory === sub
                                      ? 'text-accent border-accent'
                                      : 'text-muted-foreground border-transparent hover:text-foreground'
                                  }`}
                                >
                                  {sub.toUpperCase()}
                                </button>
                              ))}
                            </div>
                          )}
                          <ItemGrid items={sortedCatItems} onItemClick={handleItemClick} isKiosk={isKiosk} />
                        </>
                      )}
                    </div>
                  );
                })}
              </>
            </>
          )}
        </div>
      </div>
      <DishModal item={selectedItem} onClose={handleModalClose} isKiosk={isKiosk} />
      {/* Kiosk shell has no document scroll to reveal a footer in — mirrors
          Navbar's kiosk-mode simplification above. */}
      {!isKiosk && <Footer />}
    </div>
  );
}
