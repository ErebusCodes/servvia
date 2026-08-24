import { useState } from 'react';
import { ChevronDown, LayoutList, LayoutGrid } from 'lucide-react';

// ─── IMAGE MAPPING ──────────────────────────────────────────────────────────

const CATEGORY_IMAGES = {
  coffee: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400&q=80&auto=format&fit=crop',
  flatwhite: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&q=80&auto=format&fit=crop',
  latte: 'https://images.unsplash.com/photo-1570968915860-54d5c301fa9f?w=400&q=80&auto=format&fit=crop',
  mocha: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=400&q=80&auto=format&fit=crop',
  turkish: 'https://images.unsplash.com/photo-1586188136043-db7cbb2d89c0?w=400&q=80&auto=format&fit=crop',
  mocktail: 'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400&q=80&auto=format&fit=crop',
  mango: 'https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?w=400&q=80&auto=format&fit=crop',
  mojito: 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=400&q=80&auto=format&fit=crop',
  pomegranate: 'https://images.unsplash.com/photo-1610970881699-44a5587cabec?w=400&q=80&auto=format&fit=crop',
  smoothie: 'https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=400&q=80&auto=format&fit=crop',
  berry: 'https://images.unsplash.com/photo-1638176066959-3f79bef64978?w=400&q=80&auto=format&fit=crop',
  green: 'https://images.unsplash.com/photo-1622597467836-f3e6707da28f?w=400&q=80&auto=format&fit=crop',
  lassi: 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=400&q=80&auto=format&fit=crop',
  tea: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&q=80&auto=format&fit=crop',
  saffron: 'https://images.unsplash.com/photo-1519181258491-889d873e1b63?w=400&q=80&auto=format&fit=crop',
  herbal: 'https://images.unsplash.com/photo-1594631252845-29fc4cc8cde9?w=400&q=80&auto=format&fit=crop',
  juice: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=400&q=80&auto=format&fit=crop',
  water: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=400&q=80&auto=format&fit=crop',
  coke: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=400&q=80&auto=format&fit=crop',
  ginger: 'https://images.unsplash.com/photo-1527661591475-527312dd65f5?w=400&q=80&auto=format&fit=crop',
  beer: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=400&q=80&auto=format&fit=crop',
  cider: 'https://images.unsplash.com/photo-1567696153798-9111f9cd3d0d?w=400&q=80&auto=format&fit=crop',
  sparkling: 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=400&q=80&auto=format&fit=crop',
  cocktail: 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=400&q=80&auto=format&fit=crop',
  espresso: 'https://images.unsplash.com/photo-1485808191679-5f86510bd652?w=400&q=80&auto=format&fit=crop',
  manhattan: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=400&q=80&auto=format&fit=crop',
  margarita: 'https://images.unsplash.com/photo-1574169208507-84376144848b?w=400&q=80&auto=format&fit=crop',
  daiquiri: 'https://images.unsplash.com/photo-1608885898957-f8fa24f1b8df?w=400&q=80&auto=format&fit=crop',
  wine_red: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&q=80&auto=format&fit=crop',
  wine_white: 'https://images.unsplash.com/photo-1474722883778-792e7990302f?w=400&q=80&auto=format&fit=crop',
  wine_rose: 'https://images.unsplash.com/photo-1558001400-b3f2da0cda93?w=400&q=80&auto=format&fit=crop',
  spirits: 'https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=400&q=80&auto=format&fit=crop',
  whisky: 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=400&q=80&auto=format&fit=crop',
  gin: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=400&q=80&auto=format&fit=crop',
  tequila: 'https://images.unsplash.com/photo-1575023782549-62ca0d244b39?w=400&q=80&auto=format&fit=crop',
  vodka: 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=400&q=80&auto=format&fit=crop',
  raki: 'https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=400&q=80&auto=format&fit=crop'
};

function getDrinkImage(name, fallbackKey = 'cocktail') {
  const n = name.toLowerCase();
  if (n.includes('saffron')) return CATEGORY_IMAGES.saffron;
  if (n.includes('turkish coffee')) return CATEGORY_IMAGES.turkish;
  if (n.includes('flat white')) return CATEGORY_IMAGES.flatwhite;
  if (n.includes('latte')) return CATEGORY_IMAGES.latte;
  if (n.includes('mocha')) return CATEGORY_IMAGES.mocha;
  if (n.includes('cappuccino') || n.includes('long black') || n.includes('short black')) return CATEGORY_IMAGES.coffee;
  if (n.includes('espresso')) return CATEGORY_IMAGES.espresso;
  if (n.includes('herbal')) return CATEGORY_IMAGES.herbal;
  if (n.includes('tea')) return CATEGORY_IMAGES.tea;
  if (n.includes('mango lassi') || n.includes('lassi') || n.includes('ayran') || n.includes('laban') || n.includes('yogurt')) return CATEGORY_IMAGES.lassi;
  if (n.includes('berry')) return CATEGORY_IMAGES.berry;
  if (n.includes('green goddess')) return CATEGORY_IMAGES.green;
  if (n.includes('smoothie') || n.includes('cinnamon scroll') || n.includes('tropical') || n.includes('overlord')) return CATEGORY_IMAGES.smoothie;
  if (n.includes('mango')) return CATEGORY_IMAGES.mango;
  if (n.includes('pomegranate')) return CATEGORY_IMAGES.pomegranate;
  if (n.includes('mojito')) return CATEGORY_IMAGES.mojito;
  if (n.includes('mocktail') || n.includes('virgin') || n.includes('fizz') || n.includes('mint')) return CATEGORY_IMAGES.mocktail;
  if (n.includes('juice') || n.includes('orange') || n.includes('organic')) return CATEGORY_IMAGES.juice;
  if (n.includes('sparkling water') || n.includes('antipodes')) return CATEGORY_IMAGES.water;
  if (n.includes('coke') || n.includes('sprite') || n.includes('fanta') || n.includes('vimto') || n.includes('lemon lime') || n.includes('ginger beer')) return CATEGORY_IMAGES.ginger;
  if (n.includes('cider')) return CATEGORY_IMAGES.cider;
  if (n.includes('pilsner') || n.includes('ale') || n.includes('porter') || n.includes('ipa') || n.includes('beer') || n.includes('steinlager') || n.includes('corona') || n.includes('heineken') || n.includes('stella') || n.includes('lite')) return CATEGORY_IMAGES.beer;
  if (n.includes('lindauer') || n.includes('brut') || n.includes('cuvee') || n.includes('fraise') || n.includes('bubbly')) return CATEGORY_IMAGES.sparkling;
  if (n.includes('espresso martini')) return CATEGORY_IMAGES.espresso;
  if (n.includes('manhattan')) return CATEGORY_IMAGES.manhattan;
  if (n.includes('margarita')) return CATEGORY_IMAGES.margarita;
  if (n.includes('daiquiri')) return CATEGORY_IMAGES.daiquiri;
  if (n.includes('rosé') || n.includes('rose')) return CATEGORY_IMAGES.wine_rose;
  if (n.includes('pinot noir') || n.includes('merlot') || n.includes('syrah') || n.includes('shiraz') || n.includes('red')) return CATEGORY_IMAGES.wine_red;
  if (n.includes('sauvignon') || n.includes('chardonnay') || n.includes('pinot gris') || n.includes('white')) return CATEGORY_IMAGES.wine_white;
  if (n.includes('whisky') || n.includes('whiskey') || n.includes('jack') || n.includes('jameson') || n.includes('johnnie') || n.includes('canadian')) return CATEGORY_IMAGES.whisky;
  if (n.includes('gin') || n.includes('scapegrace') || n.includes('gordon')) return CATEGORY_IMAGES.gin;
  if (n.includes('tequila')) return CATEGORY_IMAGES.tequila;
  if (n.includes('vodka') || n.includes('absolut') || n.includes('finlandia') || n.includes('smirnoff')) return CATEGORY_IMAGES.vodka;
  if (n.includes('raki')) return CATEGORY_IMAGES.raki;
  if (n.includes('rum') || n.includes('brandy') || n.includes('liquor')) return CATEGORY_IMAGES.spirits;
  return CATEGORY_IMAGES[fallbackKey] || CATEGORY_IMAGES.cocktail;
}

// ─── SUB-COMPONENTS ────────────────────────────────────────────────────────

function SectionHeading({ title, subtitle = null }) {
  return (
    <div className="flex items-center gap-4 mb-6 mt-10">
      <div className="h-px flex-1 bg-border/20" />
      <div className="text-center">
        <h3 className="font-display text-lg md:text-xl tracking-[0.2em] text-foreground italic">{title}</h3>
        {subtitle && <p className="font-body text-[9px] tracking-[0.25em] text-muted-foreground uppercase mt-0.5">{subtitle}</p>}
      </div>
      <div className="h-px flex-1 bg-border/20" />
    </div>);

}

function Badge({ label }) {
  return (
    <span className="font-body text-[9px] tracking-[0.2em] text-accent/70 uppercase border border-accent/20 px-1.5 py-0.5 rounded-sm">
      {label}
    </span>);

}

// LIST items
function DrinkRow({ item }) {
  return (
    <div className="group flex items-start justify-between gap-4 py-3.5 border-b border-border/15 hover:border-border/30 transition-all">
      <div className="flex-1 min-w-0">
        <span className="font-display text-sm text-foreground tracking-wide group-hover:text-accent transition-colors">{item.name}</span>
        {item.note && <p className="font-body text-[11px] text-muted-foreground mt-0.5 leading-relaxed italic">{item.note}</p>}
      </div>
      <span className="font-body text-sm text-muted-foreground tracking-wider flex-shrink-0 tabular-nums pt-0.5 text-right">{item.price}</span>
    </div>);

}

function MocktailRow({ item }) {
  return (
    <div className="group border border-border/20 hover:border-accent/30 bg-card/30 hover:bg-card/60 transition-all p-5 rounded-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-display text-base text-foreground tracking-wide group-hover:text-accent transition-colors">{item.name}</h4>
        <span className="font-body text-sm text-accent tracking-widest flex-shrink-0">{item.price}</span>
      </div>
      <p className="font-body text-[11px] text-muted-foreground italic leading-relaxed">{item.note}</p>
    </div>);

}

function CocktailListCard({ item }) {
  return (
    <div className="group border border-border/20 hover:border-accent/30 bg-card/20 hover:bg-card/50 transition-all p-5 rounded-sm flex flex-col justify-between gap-3">
      <div>
        <h4 className="font-display text-base text-foreground tracking-wide group-hover:text-accent transition-colors mb-1.5">{item.name}</h4>
        <p className="font-body text-[11px] text-muted-foreground italic leading-relaxed">{item.ingredients}</p>
      </div>
      <span className="font-body text-sm text-foreground/70 tracking-widest">{item.price}</span>
    </div>);

}

function WineRow({ wine, type }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="group border-b border-border/15 hover:border-border/30 transition-all py-4">
      <button className="w-full text-left flex items-start justify-between gap-4" onClick={() => setExpanded(!expanded)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-display text-sm text-foreground tracking-wide group-hover:text-accent transition-colors">{wine.name}</span>
            <span className="font-body text-[10px] tracking-[0.15em] text-muted-foreground uppercase">{wine.region}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <div className="font-body text-xs text-muted-foreground tracking-wider">{wine.bottle}</div>
            <div className="font-body text-[10px] text-muted-foreground/60 tracking-wider">{wine.glass ? `Glass ${wine.glass}` : 'Bottle only'}</div>
          </div>
          <ChevronDown size={12} className={`text-muted-foreground transition-transform duration-300 flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {expanded &&
      <p className="font-body text-[11px] text-muted-foreground italic mt-2 leading-relaxed border-l border-accent/30 pl-3 ml-1">{wine.tasting}</p>
      }
    </div>);

}

function SpiritsListSection({ data }) {
  return (
    <div className="space-y-6">
      {data.groups.map((group) =>
      <div key={group.category}>
          <div className="font-body text-[9px] tracking-[0.3em] text-accent uppercase mb-2">{group.category}</div>
          {group.items.map((item) =>
        <div key={item.name} className="group flex items-center justify-between py-2.5 border-b border-border/10 hover:border-border/25 transition-all">
              <span className="font-body text-sm text-muted-foreground group-hover:text-foreground transition-colors">{item.name}</span>
              <span className="font-body text-sm text-muted-foreground tracking-wider tabular-nums">{item.price}</span>
            </div>
        )}
        </div>
      )}
    </div>);

}

// TILE items
function DrinkTile({ name, price, note, badge, imageFallback }) {
  const imgSrc = getDrinkImage(name, imageFallback);
  return (
    <div className="group bg-card border border-border/20 hover:border-accent/25 rounded-sm overflow-hidden flex flex-col transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/40">
      <div className="relative overflow-hidden h-32">
        <img src={imgSrc} alt={name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        {badge &&
        <div className="absolute top-2 left-2">
            <Badge label={badge} />
          </div>
        }
      </div>
      <div className="p-3 flex flex-col gap-1 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-display text-xs text-foreground tracking-wide leading-snug group-hover:text-accent transition-colors flex-1 min-w-0">{name}</h4>
          <span className="font-body text-xs text-muted-foreground tracking-wider flex-shrink-0 tabular-nums">{price}</span>
        </div>
        {note && <p className="font-body text-[10px] text-muted-foreground italic leading-relaxed line-clamp-1">{note}</p>}
      </div>
    </div>);

}

function CocktailTile({ item }) {
  const imgSrc = getDrinkImage(item.name, 'cocktail');
  return (
    <div className="group bg-card border border-border/20 hover:border-accent/25 rounded-sm overflow-hidden flex flex-col transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/40">
      <div className="relative overflow-hidden h-32">
        <img src={imgSrc} alt={item.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute top-2 left-2"><Badge label="Cocktail" /></div>
        <div className="absolute bottom-2 right-2 font-body text-xs text-accent tracking-widest">{item.price}</div>
      </div>
      <div className="p-3 flex flex-col gap-1">
        <h4 className="font-display text-xs text-foreground tracking-wide group-hover:text-accent transition-colors">{item.name}</h4>
        <p className="font-body text-[10px] text-muted-foreground italic leading-relaxed line-clamp-1">{item.ingredients}</p>
      </div>
    </div>);

}

function WineTile({ wine, type }) {
  const imgSrc = getDrinkImage(wine.name + ' ' + type, type === 'red' ? 'wine_red' : type === 'rose' ? 'wine_rose' : 'wine_white');
  return (
    <div className="group bg-card border border-border/20 hover:border-accent/25 rounded-sm overflow-hidden flex flex-col transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/40">
      <div className="relative overflow-hidden h-32">
        <img src={imgSrc} alt={wine.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute top-2 left-2"><Badge label={type === 'red' ? 'Red Wine' : type === 'rose' ? 'Rosé' : 'White Wine'} /></div>
      </div>
      <div className="p-3 flex flex-col gap-1 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-display text-xs text-foreground tracking-wide leading-snug group-hover:text-accent transition-colors flex-1 min-w-0">{wine.name}</h4>
        </div>
        <p className="font-body text-[9px] tracking-[0.15em] text-muted-foreground uppercase">{wine.region}</p>
        <div className="flex items-center justify-between mt-1 pt-1 border-t border-border/15">
          <span className="font-body text-[10px] text-muted-foreground">Bottle {wine.bottle}</span>
          <span className="font-body text-[10px] text-muted-foreground">{wine.glass ? `Glass ${wine.glass}` : '—'}</span>
        </div>
      </div>
    </div>);

}

function SpiritTile({ name, price, category }) {
  const imgSrc = getDrinkImage(name + ' ' + category, 'spirits');
  return (
    <div className="group bg-card border border-border/20 hover:border-accent/25 rounded-sm overflow-hidden flex flex-col transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/40">
      <div className="relative overflow-hidden h-28">
        <img src={imgSrc} alt={name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute top-2 left-2"><Badge label={category} /></div>
      </div>
      <div className="p-3 flex items-start justify-between gap-2">
        <h4 className="font-display text-xs text-foreground tracking-wide leading-snug group-hover:text-accent transition-colors flex-1 min-w-0">{name}</h4>
        <span className="font-body text-xs text-muted-foreground tracking-wider flex-shrink-0">{price}</span>
      </div>
    </div>);

}

// ─── VIEW TOGGLE BUTTON ────────────────────────────────────────────────────

function ViewToggle({ view, setView }) {
  return (
    <div className="flex items-center gap-1 border border-border/25 rounded-sm p-0.5 bg-card/30 backdrop-blur-sm">
      <button
        onClick={() => setView('list')}
        title="List view"
        className={`p-1.5 rounded-sm transition-all duration-200 ${
        view === 'list' ?
        'bg-foreground/10 text-accent shadow-sm' :
        'text-muted-foreground hover:text-foreground/70'}`
        }>
        
        <LayoutList size={13} />
      </button>
      <button
        onClick={() => setView('grid')}
        title="Tile view"
        className={`p-1.5 rounded-sm transition-all duration-200 ${
        view === 'grid' ?
        'bg-foreground/10 text-accent shadow-sm' :
        'text-muted-foreground hover:text-foreground/70'}`
        }>
        
        <LayoutGrid size={13} />
      </button>
    </div>);

}

const GRID_CLASS = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3';

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────

export default function DrinksMenu({ items = [] }) {
  const [activeTab, setActiveTab] = useState('non-alcoholic');
  const [view, setView] = useState('list');

  const formatPrice = (p) => {
    if (!p) return '';
    const str = String(p);
    return str.startsWith('$') ? str : `$${str}`;
  };

  // Group items by subCategory
  const coldDrinks = items.filter(i => i.sub_category === 'Cold Drinks & Juices');
  const coffee = items.filter(i => i.sub_category === 'Coffee');
  const mocktails = items.filter(i => i.sub_category === 'Mocktails');
  const smoothies = items.filter(i => i.sub_category === 'Natural Smoothies & Yogurt Drinks');
  const tea = items.filter(i => i.sub_category === 'Tea');

  const beers = items.filter(i => i.sub_category === 'Beers & Cider');
  const bubbly = items.filter(i => i.sub_category === 'Bubbly');
  const cocktails = items.filter(i => i.sub_category === 'Cocktails').map(i => ({
    name: i.name,
    ingredients: i.raw?.nutritionalDetails?.ingredients || i.description || '',
    price: formatPrice(i.price)
  }));
  const reds = items.filter(i => i.sub_category === 'Reds').map(i => ({
    name: i.name,
    region: i.raw?.nutritionalDetails?.region || '',
    tasting: i.description,
    bottle: i.raw?.nutritionalDetails?.bottlePrice || formatPrice(i.price),
    glass: i.raw?.nutritionalDetails?.glassPrice || null
  }));
  const whites = items.filter(i => i.sub_category === 'Whites & Rosé').map(i => ({
    name: i.name,
    region: i.raw?.nutritionalDetails?.region || '',
    tasting: i.description,
    bottle: i.raw?.nutritionalDetails?.bottlePrice || formatPrice(i.price),
    glass: i.raw?.nutritionalDetails?.glassPrice || null
  }));

  const spiritsItems = items.filter(i => i.sub_category === 'Spirits & Liquors');
  const spiritGroupsMap = {};
  spiritsItems.forEach(i => {
    const grp = i.raw?.nutritionalDetails?.group || 'Other';
    if (!spiritGroupsMap[grp]) spiritGroupsMap[grp] = [];
    spiritGroupsMap[grp].push({ name: i.name, price: formatPrice(i.price) });
  });
  const spiritsGroups = Object.keys(spiritGroupsMap).map(key => ({
    category: key,
    items: spiritGroupsMap[key]
  }));

  const NON_ALCOHOLIC = {
    coldDrinks: { title: 'Cold Drinks & Juices', badge: 'Cold Drink', items: coldDrinks.map(i => ({ name: i.name, note: i.description, price: i.raw?.price || formatPrice(i.price) })) },
    coffee: { title: 'Coffee', badge: 'Coffee', items: coffee.map(i => ({ name: i.name, note: i.description, price: formatPrice(i.price) })) },
    mocktails: { title: 'Mocktails', badge: 'Mocktail', items: mocktails.map(i => ({ name: i.name, note: i.description, price: formatPrice(i.price) })) },
    smoothies: { title: 'Natural Smoothies & Yogurt Drinks', badge: 'Smoothie', items: smoothies.map(i => ({ name: i.name, note: i.description, price: formatPrice(i.price) })) },
    tea: { title: 'Tea', badge: 'Tea', items: tea.map(i => ({ name: i.name, note: i.description, price: formatPrice(i.price) })) },
  };

  const ALCOHOLIC = {
    beers: { title: 'Beers & Cider', badge: 'Beer', items: beers.map(i => ({ name: i.name, note: i.description, price: formatPrice(i.price) })) },
    bubbly: { title: 'Bubbly', subtitle: 'Sparkling Wine', badge: 'Sparkling', items: bubbly.map(i => ({ name: i.name, note: i.description, price: formatPrice(i.price) })) },
    cocktails,
    reds,
    spirits: { title: 'Spirits & Liquors', badge: 'Spirit', groups: spiritsGroups },
    whites
  };

  return (
    <div>
      {/* Sub-tab nav + view toggle */}
      <div className="sticky top-[52px] bg-background/98 backdrop-blur-md z-[9] border-b border-border/20 py-4 mt-8 mb-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-10 flex-1">
            {[
            { id: 'non-alcoholic', label: 'Non-Alcoholic' },
            { id: 'alcoholic', label: 'Alcoholic' }].
            map((tab) =>
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative font-body text-xs tracking-[0.25em] uppercase pb-3 transition-colors ${
              activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/70'}`
              }>
              
                {tab.label}
                <span className={`absolute bottom-0 left-0 right-0 h-px bg-accent transition-all duration-300 ${activeTab === tab.id ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'}`} />
              </button>
            )}
          </div>
          <ViewToggle view={view} setView={setView} />
        </div>
      </div>

      {/* NON-ALCOHOLIC */}
      {activeTab === 'non-alcoholic' &&
      <div style={{ animation: 'drinksTabFade 0.35s ease-out forwards' }}>

          {/* Cold Drinks */}
          <SectionHeading title={NON_ALCOHOLIC.coldDrinks.title} />
          {view === 'list' ?
        <div>{NON_ALCOHOLIC.coldDrinks.items.map((i) => <DrinkRow key={i.name} item={i} />)}</div> :
        <div className={GRID_CLASS}>{NON_ALCOHOLIC.coldDrinks.items.map((i) => <DrinkTile key={i.name} {...i} badge="Cold Drink" imageFallback="juice" />)}</div>
        }

          {/* Coffee */}
          <SectionHeading title={NON_ALCOHOLIC.coffee.title} />
          {view === 'list' ?
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12">{NON_ALCOHOLIC.coffee.items.map((i) => <DrinkRow key={i.name} item={i} />)}</div> :
        <div className={GRID_CLASS}>{NON_ALCOHOLIC.coffee.items.map((i) => <DrinkTile key={i.name} {...i} badge="Coffee" imageFallback="coffee" />)}</div>
        }

          {/* Mocktails */}
          <SectionHeading title={NON_ALCOHOLIC.mocktails.title} />
          {view === 'list' ?
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{NON_ALCOHOLIC.mocktails.items.map((i) => <MocktailRow key={i.name} item={i} />)}</div> :
        <div className={GRID_CLASS}>{NON_ALCOHOLIC.mocktails.items.map((i) => <DrinkTile key={i.name} name={i.name} price={i.price} note={i.note} badge="Mocktail" imageFallback="mocktail" />)}</div>
        }

          {/* Smoothies */}
          <SectionHeading title={NON_ALCOHOLIC.smoothies.title} />
          {view === 'list' ?
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">{NON_ALCOHOLIC.smoothies.items.map((i) => <DrinkRow key={i.name} item={i} />)}</div> :
        <div className={GRID_CLASS}>{NON_ALCOHOLIC.smoothies.items.map((i) => <DrinkTile key={i.name} {...i} badge="Smoothie" imageFallback="smoothie" />)}</div>
        }

          {/* Tea */}
          <SectionHeading title={NON_ALCOHOLIC.tea.title} />
          {view === 'list' ?
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">{NON_ALCOHOLIC.tea.items.map((i) => <DrinkRow key={i.name} item={i} />)}</div> :
        <div className={GRID_CLASS}>{NON_ALCOHOLIC.tea.items.map((i) => <DrinkTile key={i.name} {...i} badge="Tea" imageFallback="tea" />)}</div>
        }
        </div>
      }

      {/* ALCOHOLIC */}
      {activeTab === 'alcoholic' &&
      <div style={{ animation: 'drinksTabFade 0.35s ease-out forwards' }}>

          {/* BYO Banner */}
          <div className="border border-accent/25 bg-accent/5 rounded-sm px-6 py-4 mb-10 text-center">
            <p className="font-display text-sm md:text-base tracking-[0.15em] text-foreground italic">BYO Wine Only</p>
            <p className="font-body text-xs tracking-[0.2em] text-accent mt-1">$7.00 · Conditions Apply</p>
          </div>

          {/* Beers */}
          <SectionHeading title={ALCOHOLIC.beers.title} />
          {view === 'list' ?
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">{ALCOHOLIC.beers.items.map((i) => <DrinkRow key={i.name} item={i} />)}</div> :
        <div className={GRID_CLASS}>{ALCOHOLIC.beers.items.map((i) => <DrinkTile key={i.name} {...i} badge={i.name.toLowerCase().includes('cider') ? 'Cider' : 'Beer'} imageFallback={i.name.toLowerCase().includes('cider') ? 'cider' : 'beer'} />)}</div>
        }

          {/* Bubbly */}
          <SectionHeading title={ALCOHOLIC.bubbly.title} subtitle={ALCOHOLIC.bubbly.subtitle} />
          {view === 'list' ?
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12">{ALCOHOLIC.bubbly.items.map((i) => <DrinkRow key={i.name} item={i} />)}</div> :
        <div className={GRID_CLASS}>{ALCOHOLIC.bubbly.items.map((i) => <DrinkTile key={i.name} {...i} badge="Sparkling" imageFallback="sparkling" />)}</div>
        }

          {/* Cocktails */}
          <SectionHeading title="Cocktails" />
          <div className="text-center mb-6">
            <span className="font-body text-[10px] tracking-[0.3em] text-accent uppercase border border-accent/30 px-4 py-1.5 rounded-sm">All Standard Cocktails — $17.00</span>
          </div>
          {view === 'list' ?
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">{ALCOHOLIC.cocktails.map((c) => <CocktailListCard key={c.name} item={c} />)}</div> :
        <div className={GRID_CLASS}>{ALCOHOLIC.cocktails.map((c) => <CocktailTile key={c.name} item={c} />)}</div>
        }

          {/* Reds */}
          <SectionHeading title="Reds" subtitle="Wine" />
          {view === 'list' ?
        <>
                <div className="flex items-center justify-end gap-8 mb-2 pr-8">
                  <span className="font-body text-[9px] tracking-[0.2em] text-muted-foreground uppercase">Bottle</span>
                  <span className="font-body text-[9px] tracking-[0.2em] text-muted-foreground uppercase">Glass</span>
                </div>
                <div>{ALCOHOLIC.reds.map((w) => <WineRow key={w.name} wine={w} type="red" />)}</div>
              </> :
        <div className={GRID_CLASS}>{ALCOHOLIC.reds.map((w) => <WineTile key={w.name} wine={w} type="red" />)}</div>
        }

          {/* Spirits */}
          <SectionHeading title={ALCOHOLIC.spirits.title} />
          {view === 'list' ?
        <SpiritsListSection data={ALCOHOLIC.spirits} /> :
        <div className={GRID_CLASS}>
                {ALCOHOLIC.spirits.groups.flatMap((g) => g.items.map((item) =>
          <SpiritTile key={g.category + item.name} name={item.name} price={item.price} category={g.category} />
          ))}
              </div>
        }

          {/* Whites & Rosé */}
          <SectionHeading title="Whites & Rosé" subtitle="Wine" />
          {view === 'list' ?
        <>
                <div className="flex items-center justify-end gap-8 mb-2 pr-8">
                  <span className="font-body text-[9px] tracking-[0.2em] text-muted-foreground uppercase">Bottle</span>
                  <span className="font-body text-[9px] tracking-[0.2em] text-muted-foreground uppercase">Glass</span>
                </div>
                <div>{ALCOHOLIC.whites.map((w) => <WineRow key={w.name} wine={w} type={w.name.toLowerCase().includes('rosé') || w.name.toLowerCase().includes('rose') ? 'rose' : 'white'} />)}</div>
              </> :
        <div className={GRID_CLASS}>{ALCOHOLIC.whites.map((w) => <WineTile key={w.name} wine={w} type={w.name.toLowerCase().includes('rosé') || w.name.toLowerCase().includes('rose') ? 'rose' : 'white'} />)}</div>
        }
        </div>
      }

      <style>{`
        @keyframes drinksTabFade {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>);

}