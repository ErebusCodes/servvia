// shared/menuData.js
//
// Canonical menu data, sourced from VERDURA_Final_Menu.docx (the sole
// menu source of truth). Categories, items, descriptions, prices and
// dietary tags below are transcribed directly from that document.

let _sid = 0;

export const MENU_COLLATOR = new Intl.Collator('en-NZ', {
  sensitivity: 'base',
  numeric: true,
});

/** Canonical A-Z comparison for shared and normalized menu-item shapes. */
export function compareMenuItemsAlphabetically(a, b) {
  const nameA = String(a?.title ?? a?.name ?? a?.menuItemTitle ?? '');
  const nameB = String(b?.title ?? b?.name ?? b?.menuItemTitle ?? '');
  return MENU_COLLATOR.compare(nameA, nameB);
}

export function sortMenuItemsAlphabetically(items) {
  return [...items].sort(compareMenuItemsAlphabetically);
}

function si(categoryId, subCategory, title, price, tags, desc, featured = false, imageUrl = null) {
  return {
    id: `seed-${++_sid}`,
    categoryId,
    subCategory,
    title,
    description: desc,
    imageUrl,
    price: String(price),
    nutritionalDetails: { tags, isFeatured: featured },
    isSpicy: false,
    isAvailable: true,
    sortOrder: _sid,
  };
}

export const SEED_CATEGORIES = [
  {
    id: 'cat-to-share', name: 'To Share', description: 'Warm bread, dips and mezze platters for the table',
    imageUrl: null, sortOrder: 0, isActive: true, subs: [],
  },
  {
    id: 'cat-small-plates', name: 'Small Plates', description: 'Warm and cold small plates',
    imageUrl: null, sortOrder: 1, isActive: true, subs: [],
  },
  {
    id: 'cat-salads', name: 'Salads', description: 'Fresh salads',
    imageUrl: null, sortOrder: 2, isActive: true, subs: [],
  },
  {
    id: 'cat-kebabs', name: 'Traditional Mediterranean Kebabs', description: 'Wrap, pita pocket or on a plate — served with tabbouleh, green salad and two house sauces',
    imageUrl: null, sortOrder: 3, isActive: true, subs: [],
  },
  {
    id: 'cat-mains', name: 'Mains', description: 'All mains are served with hummus, salad, rice, bread and house sauces',
    imageUrl: null, sortOrder: 4, isActive: true, subs: [],
  },
  {
    id: 'cat-feasts', name: 'Verdura Sharing Feasts', description: 'Sharing feasts for the table',
    imageUrl: null, sortOrder: 5, isActive: true, subs: [],
  },
  {
    id: 'cat-oven', name: 'Fresh From The Oven', description: 'Breads, loaves and wood-fired pizzas',
    imageUrl: null, sortOrder: 6, isActive: true, subs: [],
  },
  {
    id: 'cat-burgers-pasta', name: 'Burgers & Pasta', description: 'Burgers and pasta',
    imageUrl: null, sortOrder: 7, isActive: true, subs: [],
  },
  {
    id: 'cat-sides', name: 'Sides', description: 'Sides, dips, bread and skewers',
    imageUrl: null, sortOrder: 8, isActive: true, subs: [],
  },
  {
    id: 'cat-desserts', name: 'Desserts', description: 'Mediterranean sweets',
    imageUrl: null, sortOrder: 9, isActive: true, subs: [],
  },
];

const UNSORTED_SEED_ITEMS = [
  // ── To Share ────────────────────────────────────────────────────
  si("cat-to-share", null, "Pita Bread & Dips", "17", [], "Warm Pita bread served with your choice of two-house dips. Choose two: Hummus | Muhammara | Mutabal | Tzatziki | Beetroot.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/e6805caf-ecbd-477a-8dde-535d1312a374/original/pita-bread-dips.jpg"),
  si("cat-to-share", null, "Mezze Platter For Two", "33", [], "A selection of warm and cold mezze including falafel, Dolma, crispy Sigara Börek, kibbeh or vegetable sambuusa, two house dips with bread."),
  si("cat-to-share", null, "Mezze Platter For Four", "60", [], "A generous selection of warm and cold mezze, four house dips, Pita bread and seasonal accompaniments."),
  si("cat-to-share", null, "Verdura Mezze Board", "70", [], "Hummus, muhammara, mutabal, olives, spicy potatoes, Dolma, pickles, falafel, kibbeh or vegetable sambuusa and mini-Sigara Börek, served with pita bread.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/19a532fe-0815-49e7-bf5f-0fc81077f8d8/original/verdura-mezze-board.jpg"),

  // ── Small Plates ────────────────────────────────────────────────────
  si("cat-small-plates", null, "Mutabal With Kibbeh", "17", [], "Smoky roasted eggplant, tahini and lemon topped with crispy meat kibbeh.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/ed3e0c10-40ff-4abe-b586-eb5aa64ec3ca/original/mytabal-with-kibbe.jpg"),
  si("cat-small-plates", null, "Dolma", "10", ['V'], "Vine leaves filled with seasoned rice and vegetables, served with yoghurt.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/e8331b3d-7166-4cbe-9095-8f16cbfc1e1a/original/dolma.jpg"),
  si("cat-small-plates", null, "Battata Harra", "12.5", ['VG', 'GF'], "Crispy potatoes with chilli, coriander, cumin and fresh herbs.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/d54d5704-162e-4ea0-bdf4-d19ee21c8e65/original/battata-harra.jpg"),
  si("cat-small-plates", null, "Arayes & Cheese", "20", [], "Grilled pita filled with seasoned minced meat, vegetables and cheese.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/f93d63c4-9f56-42eb-8870-3458f232d8ad/original/arayes-cheese.jpg"),
  si("cat-small-plates", null, "Crispy Dynamite Prawns", "18", [], "Crispy prawns tossed in a creamy, lightly spicy dynamite sauce.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/ba62a16d-5f5e-48bf-ae72-e59656245f25/original/crispy-dynamite-prawns.jpg"),
  si("cat-small-plates", null, "Falafel Plate", "15", ['VG', 'GF', 'DF'], "Crispy falafel with fresh vegetables, tahini and pickles.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/3426ef34-ed29-4305-8456-89f58076e870/original/falafel-plate.jpg"),
  si("cat-small-plates", null, "Grilled Halloumi", "18", ['V'], "Grilled halloumi with tomato, cucumber and extra virgin olive oil.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/556621d7-5ffe-4177-ae99-749f95591c21/original/grilled-halloumi.jpg"),

  // ── Salads ────────────────────────────────────────────────────
  si("cat-salads", null, "Fattoush", "19", ['VG', 'DF'], "Tomato, cucumber, capsicum, radish, mint and parsley with crispy bread, sumac and pomegranate dressing.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/eb669ef7-9c81-4c51-844c-9b7ed5fc4410/original/fattoush.jpg"),
  si("cat-salads", null, "Mediterranean Greek Salad", "18", ['V', 'GF'], "Tomato, cucumber, olives, red onion and feta with oregano, lemon and extra virgin olive oil."),
  si("cat-salads", null, "Tabbouleh", "10", ['VG', 'DF'], "Fresh parsley, mint, tomato, onion and bulgur with lemon and olive oil."),
  si("cat-salads", null, "Verdura Salad", "25", [], "Grilled prawns, cherry tomatoes, mixed greens, avocado and feta with toasted bread and Mediterranean dressing.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/df384a23-5982-4e20-ad32-9b2f70981934/original/verdura-salad.jpg"),
  si("cat-salads", null, "Halloumi & Avocado Salad", "20", ['V', 'GF'], "Mixed greens, avocado, grilled halloumi, tomato and Mediterranean dressing."),
  si("cat-salads", null, "Chicken Avocado Salad", "22", ['GF'], "Mixed green lettuce, cherry tomato, avocado and marinated grilled chicken breast tossed with mayo basil dressing.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/fc9fe7d0-35aa-4cbf-a5fa-903ec5943e8f/original/chicken-avocado-salad.jpg"),

  // ── Traditional Mediterranean Kebabs ────────────────────────────────────────────────────
  si("cat-kebabs", null, "Wrap | Pita Pocket | On a Plate", "19", [], "Served with tabbouleh, green salad and two house sauces. Choose up to two fillings. Standard fillings — Döner Chicken, Döner Lamb, Falafel, Halloumi — one included at the $19 base price; mix any two standard fillings for +$0.50 ($19.50 total). Premium fillings: Beef rump strip +$1 ($20 total), Chicken Shish $20, Lamb Shish $20.50, Kofta Kebab $20, Beyond Meat $20.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/a2c99222-9dcd-4e71-a6ae-e1a9a2fb6895/original/kebab-wrap.jpg"),
  si("cat-kebabs", null, "Loaded On Chips", "19", ['GF+', 'DF+'], "Choice of fillings served on a bed of hot chips with your choice of two sauces. Choose up to two fillings — Chicken / Lamb / Falafel / Beef $1."),

  // ── Mains ────────────────────────────────────────────────────
  si("cat-mains", null, "Verdura Signature", "50", [], "A generous selection of chicken shish, lamb shish, Kebab, grilled chicken, falafel and crispy Sigara Börek."),
  si("cat-mains", null, "Chicken Shish [Shish Taouk]", "34", [], "Marinated chicken skewers with Mediterranean herbs and spices.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/0eaca1d8-fee7-45b9-ba7d-38c4758eb2e1/original/shish-taouk.jpg"),
  si("cat-mains", null, "Lamb Shish [Laham Meshwi]", "37", ['GF+'], "Tender marinated lamb skewers with Mediterranean herbs and spices.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/9d7489db-8372-45d3-8236-377d3da29791/original/lamb-shish.jpg"),
  si("cat-mains", null, "Mixed Shish", "39", [], "Chicken shish, lamb shish and Kofta Kebab.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/88c2fb5f-5b68-4db1-8b3a-91a534e793ba/original/mixed-shish.jpg"),
  si("cat-mains", null, "Persian Koobideh [Kofta Kebab]", "36", [], "Seasoned lamb Kebab with aromatic spices and tahini.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/9f84226a-94d6-4077-be6e-7178d57623b2/original/persian-koobideh.jpg"),
  si("cat-mains", null, "Iskender Grill Chicken", "30", [], "Grilled chicken with rich tomato sauce and yoghurt sauce."),
  si("cat-mains", null, "Iskender Döner", "30", [], "Choice of chicken, lamb or mixed Döner."),
  si("cat-mains", null, "Greek Eggplant & Lamb Moussaka", "24", [], "Layers of eggplant, potato and seasoned lamb topped with creamy béchamel."),
  si("cat-mains", null, "Kuwaiti Chicken Machboos", "25", [], "Fragrant spiced rice with tender chicken, crispy onions and traditional daqoos.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/b7aa7f9b-4738-4281-a7d1-3366b8a9878d/original/kuwaiti-chicken-machboos.jpg"),
  si("cat-mains", null, "Kuwaiti Lamb Shank Machboos", "45", [], "Tender lamb shank (Mooza) slow-cooked with an aromatic blend of spices, served on fragrant rice, garnished with traditional Kuwaiti toppings and accompanied by a rich tomato sauce (daqoos).", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/e6c0b461-0c23-4e19-adb2-df61fed82b69/original/kuwaiti-lamb-shank-machboos.jpg"),

  // ── Verdura Sharing Feasts ────────────────────────────────────────────────────
  si("cat-feasts", null, "Verdura Grill For Two", "60", [], "Chicken shish, lamb shish and koobideh with bread, hummus, salad, flavoured rice and toum.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/4cad9e88-087e-43db-aa57-c05cc0658101/original/verdura-grill-for-two.jpg"),
  si("cat-feasts", null, "Verdura Couple Feast", "75", [], "Koobideh, lamb shish, chicken shish, mini Sigara Börek, kibbeh and falafel with Mediterranean sides.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/9ed86b2e-749d-419b-b061-0dc27cd2d805/original/verdura-couple-feast.jpg"),
  si("cat-feasts", null, "Verdura Family Feast", "130", [], "Chicken shish, lamb shish, koobideh and grilled chicken with flavoured rice or fries, salad, hummus, Turkish bread and toum."),
  si("cat-feasts", null, "Verdura Grand Feast", "185", [], "A celebration for 5 or 10 guests featuring chicken shish, koobideh, lamb shish, grilled half chicken, Kuwaiti chicken machboos and lamb shank with Mediterranean accompaniments. $185 for 5 guests, $340 for 10 guests."),

  // ── Fresh From The Oven ────────────────────────────────────────────────────
  si("cat-oven", null, "Garlic & Cheese Pide", "15", ['V'], "Warm Turkish-style pide with garlic and melted cheese.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/d7a2abc6-2407-4c8f-9ad7-fab0b13bea11/original/garlic-cheese-pide.jpg"),
  si("cat-oven", null, "Za'atar Loaf", "13", ['VG', 'DF'], "Freshly baked flatbread with za'atar, sesame and olive oil."),
  si("cat-oven", null, "Halloumi Loaf", "15", ['V'], "Warm baked bread with halloumi, parsley and sesame.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/20110f68-b0e4-45c4-b91d-3fb2c7b24349/original/halloumi-loaf.jpg"),
  si("cat-oven", null, "Lebanese Lahm Bi Ajin", "22", [], "Thin baked flatbread topped with seasoned minced meat, herbs and red pepper.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/dbfe28c1-3790-48f9-9ac2-58f7a2a6c12c/original/lebanese-lahm-bi-ajin.jpg"),
  si("cat-oven", null, "Classic Margherita", "20", ['V'], "Tomato, mozzarella and fresh basil."),
  si("cat-oven", null, "Verdura Mediterranean Pizza", "24", ['V'], "Pesto, olives, spinach, cherry tomato, caramelised onion, sun-dried tomato, feta and parmesan.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/374f6428-c524-4dd0-82e0-bef1e8f8ef25/original/verdura-pizza.jpg"),
  si("cat-oven", null, "Spicy Mediterranean Pizza", "23.5", ['V'], "Tomato, mozzarella, eggplant, capsicum, onion, olives, feta and spicy aioli."),
  si("cat-oven", null, "Chicken Ballista Pizza", "23.5", [], "Tomato base, pineapple, capsicum, chicken, herbs and mozzarella cheese with mayo, onion, makhani sauce and hot peri-peri sauce.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/81ff6af7-3109-45fe-9078-a31f0d03be97/original/chicken-ballista-pizza.jpg"),
  si("cat-oven", null, "Pesto Chicken Pizza", "23.5", [], "Pesto base, mozzarella cheese, herbs, tomatoes, spinach, capsicum, coriander, chicken with mayo."),
  si("cat-oven", null, "Delight Pizza", "23.5", [], "Choice of chicken, lamb or mixed meat with tomato, mushroom, onion, mozzarella and house sauces."),

  // ── Burgers & Pasta ────────────────────────────────────────────────────
  si("cat-burgers-pasta", null, "Mighty Angus Beef Burger", "26", [], "Angus beef patty, cheese, pickle, lettuce, tomato, caramelised onion and truffle mayo, served with fries.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/63baa08d-c73c-4189-a078-1d3129ecc9cd/original/mighty-angus-burger.jpg"),
  si("cat-burgers-pasta", null, "Mediterranean Chicken Burger", "26", [], "Grilled chicken, cheese, lettuce, tomato, pickle and romesco sauce, served with fries.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/a110337e-a417-4854-9731-f64bb3da52f2/original/mediterranean-chicken-burger.jpg"),
  si("cat-burgers-pasta", null, "Verdura Veggie Burger", "24", ['V'], "Vegetable patty, hummus, grilled eggplant, lettuce, tomato and harissa mayo, served with fries."),
  si("cat-burgers-pasta", null, "Shrimp Pasta", "28.5", [], "Penne with prawns in a creamy tomato sauce.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/76cb3442-2558-4314-939f-e310f7b42211/original/penne-pasta.jpg"),
  si("cat-burgers-pasta", null, "Chicken Alfredo", "27.5", [], "Fettuccine with grilled chicken and creamy Alfredo sauce.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/e6eed837-ee20-4945-bb2e-f460f787a52c/original/fettuccine-alfredo.jpg"),

  // ── Sides ────────────────────────────────────────────────────
  si("cat-sides", null, "Fries", "10", ['GF', 'DF'], ""),
  si("cat-sides", null, "Flavoured Rice", "8", [], "", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/775c0d42-97a7-4ef2-b3c7-ff195a064550/original/flavoured-rice.jpg"),
  si("cat-sides", null, "White Rice", "6", ['GF', 'V'], ""),
  si("cat-sides", null, "Hummus", "9", ['VG', 'GF', 'DF'], "", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/d0b2230e-0916-44c6-bd3b-7aaea3e154c9/original/hummus-side.jpg"),
  si("cat-sides", null, "Mutabal", "8", ['V', 'GF'], ""),
  si("cat-sides", null, "Muhammara", "9", ['V'], ""),
  si("cat-sides", null, "Tzatziki", "8", ['V', 'GF'], ""),
  si("cat-sides", null, "Beetroot Dip", "8", ['V', 'GF'], ""),
  si("cat-sides", null, "Tabbouleh", "10", ['VG', 'DF'], ""),
  si("cat-sides", null, "Green Salad", "8", [], "", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/663a0a98-6a7f-41cd-8a43-9ec017d71aeb/original/green-salad-side.jpg"),
  si("cat-sides", null, "Pita Bread — Full", "6.5", [], "", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/d20e7b2c-f948-4d6a-92cf-ebb6f33afd5a/original/pita-bread-full.jpg"),
  si("cat-sides", null, "Pita Bread — Half", "3.5", [], "", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/d20e7b2c-f948-4d6a-92cf-ebb6f33afd5a/original/pita-bread-full.jpg"),
  si("cat-sides", null, "Halloumi", "10", ['V'], ""),
  si("cat-sides", null, "Falafel", "7", ['VG', 'GF', 'DF'], ""),
  si("cat-sides", null, "Chicken Skewer", "11", ['GF'], ""),
  si("cat-sides", null, "Lamb Skewer", "13", ['GF'], ""),
  si("cat-sides", null, "Kebab Skewer", "13", ['GF', 'DF'], ""),

  // ── Desserts ────────────────────────────────────────────────────
  si("cat-desserts", null, "Baklava", "12", [], "Layers of crisp pastry, nuts and fragrant syrup.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/4cd0b31a-7cc6-4eb5-b536-a0304be59e39/original/baklava.jpg"),
  si("cat-desserts", null, "Künefe", "15", [], "Warm shredded pastry with melted cheese and fragrant syrup.", false, "/menu-images/kunefe.png"),
  si("cat-desserts", null, "Lugaimat", "12", [], "Golden Kuwaiti-style dough bites with date or honey syrup and sesame.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/ccb9c7b6-79bf-4860-bb3b-6553e2b08ebe/original/lugaimat.png"),
  si("cat-desserts", null, "Tiramisu", "13", [], "Classic Italian dessert with espresso, mascarpone and cocoa.", false, "https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/a3baab19-07b5-481e-b176-8deb6d22f997/original/tiramisu.jpg"),
  si("cat-desserts", null, "Verdura Dessert Platter", "28", [], "A selection of Mediterranean sweets for sharing."),
];

export const SEED_ITEMS = [...UNSORTED_SEED_ITEMS].sort((a, b) => {
  const catA = SEED_CATEGORIES.find((c) => c.id === a.categoryId);
  const catB = SEED_CATEGORIES.find((c) => c.id === b.categoryId);
  const orderA = catA?.sortOrder ?? 0;
  const orderB = catB?.sortOrder ?? 0;
  if (orderA !== orderB) return orderA - orderB;

  const subA = a.subCategory || '';
  const subB = b.subCategory || '';
  if (subA !== subB) {
    if (catA) {
      const idxA = catA.subs.findIndex((s) => s.name === subA);
      const idxB = catA.subs.findIndex((s) => s.name === subB);
      if (idxA !== -1 && idxB !== -1 && idxA !== idxB) {
        return idxA - idxB;
      }
    }
    return subA.localeCompare(subB);
  }

  return compareMenuItemsAlphabetically(a, b);
}).map((item, idx) => ({ ...item, sortOrder: idx }));

export const CANONICAL_MENU_ITEM_COUNT = 70;
