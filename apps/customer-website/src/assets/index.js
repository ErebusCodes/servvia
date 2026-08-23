import homeMenuImage from './image/home_menu.jpg';

// Centralized asset registry for Verdura
// Hero video is served from Verdura's canonical GCS public-media bucket
// (see README §4.3 / decisions-log DL-103).
const homeHeroVideo = 'https://storage.googleapis.com/verdura-media-public-d3794338b2/website/hero/intro.mp4';

export const ASSETS = {
  hero: {
    home:    homeHeroVideo,
    menu:    "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1200&q=85&auto=format&fit=crop",
    about:   "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=85&auto=format&fit=crop",
    contact: "https://images.unsplash.com/photo-1544148103-0773bf10d330?w=1200&q=85&auto=format&fit=crop",
  },
  gallery: {
    food1: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=800&q=85&auto=format&fit=crop",
    food2: "https://images.unsplash.com/photo-1529042410759-befb1204b468?w=800&q=85&auto=format&fit=crop",
    food3: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=85&auto=format&fit=crop",
    food4: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=85&auto=format&fit=crop",
  },
  about: {
    chef:        "https://images.unsplash.com/photo-1622021142947-da7dedc7c39a?w=800&q=85&auto=format&fit=crop",
    reservation: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=85&auto=format&fit=crop",
  },
  home: {
    menu:        homeMenuImage,
    reservation: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=85&auto=format&fit=crop",
    about:       "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=85&auto=format&fit=crop",
  },
};
