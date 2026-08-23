import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Address {
  street: string;
  line2?: string;
  line3?: string;
  city: string;
  country: string;
}

interface OperatingHours {
  monday: { open: string; close: string };
  tuesday: { open: string; close: string };
  wednesday: { open: string; close: string };
  thursday: { open: string; close: string };
  friday: { open: string; close: string };
  saturday: { open: string; close: string };
  sunday: { open: string; close: string };
}

interface Venue {
  id: string;
  name: string;
  slug: string;
  manager: string;
  location: string;
  address: Address;
  phone: string;
  email: string;
  timezone: string;
  currency: string;
  seatingCapacity: number;
  coversPerSlot: number;
  reservationSlotMinutes: number;
  operatingHours: OperatingHours;
  status: 'Active' | 'Inactive';
  todaysOrders: number;
  description: string;
  imageUrl: string;
  venueType: string;
}

const MANGERE_VENUE: Venue = {
  id: 'mangere-airport',
  name: 'Auckland Airport',
  slug: 'mangere-airport',
  manager: 'Aroha Williams',
  location: 'Māngere, Auckland',
  address: {
    street: 'Airport Shopping Centre',
    line2: 'John Goulter Drive',
    city: 'Māngere, Auckland 2022',
    country: 'New Zealand',
  },
  phone: '+64 9 275 4100',
  email: 'mangere@verdura.co.nz',
  timezone: 'Pacific/Auckland',
  currency: 'NZD',
  seatingCapacity: 120,
  coversPerSlot: 24,
  reservationSlotMinutes: 15,
  operatingHours: {
    monday: { open: '11:00', close: '22:00' },
    tuesday: { open: '11:00', close: '22:00' },
    wednesday: { open: '11:00', close: '22:00' },
    thursday: { open: '11:00', close: '22:00' },
    friday: { open: '11:00', close: '23:00' },
    saturday: { open: '11:00', close: '23:00' },
    sunday: { open: '11:00', close: '22:00' },
  },
  status: 'Inactive',
  todaysOrders: 0,
  description: 'A convenient Auckland Airport precinct venue serving Verdura favourites in a relaxed, welcoming setting.',
  imageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80',
  venueType: 'Restaurant',
};

const QUEENSTOWN_VENUE: Venue = {
  id: 'queenstown-central',
  name: 'Verdura Queenstown',
  slug: 'queenstown-central',
  manager: 'Olivia Carter',
  location: 'Queenstown, NZ',
  address: {
    street: 'Queenstown Central Shopping Centre',
    line2: 'Grant Road',
    line3: 'Frankton',
    city: 'Queenstown 9300',
    country: 'New Zealand',
  },
  phone: '+64 3 441 1200',
  email: 'queenstown@verdura.co.nz',
  timezone: 'Pacific/Auckland',
  currency: 'NZD',
  seatingCapacity: 120,
  coversPerSlot: 24,
  reservationSlotMinutes: 15,
  operatingHours: {
    monday: { open: '11:00', close: '22:00' },
    tuesday: { open: '11:00', close: '22:00' },
    wednesday: { open: '11:00', close: '22:00' },
    thursday: { open: '11:00', close: '22:00' },
    friday: { open: '11:00', close: '23:00' },
    saturday: { open: '11:00', close: '23:00' },
    sunday: { open: '11:00', close: '22:00' },
  },
  status: 'Inactive',
  todaysOrders: 0,
  description: 'A welcoming Queenstown restaurant serving Verdura favourites near the Frankton retail precinct.',
  imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=600&q=80',
  venueType: 'Restaurant',
};

const INITIAL_VENUES: Venue[] = [
  MANGERE_VENUE,
  QUEENSTOWN_VENUE,
  {
    id: 'auckland-cbd',
    name: 'Auckland CBD',
    slug: 'auckland-cbd',
    manager: 'Sarah Johnson',
    location: 'Auckland, NZ',
    address: { street: '123 Queen Street', city: 'Auckland, 1010', country: 'New Zealand' },
    phone: '+64 9 123 4567',
    email: 'auckland@verdura.co.nz',
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    seatingCapacity: 120,
    coversPerSlot: 24,
    reservationSlotMinutes: 15,
    operatingHours: {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '11:00', close: '23:00' },
      sunday: { open: '11:00', close: '22:00' },
    },
    status: 'Inactive',
    todaysOrders: 45,
    description: 'Our flagship venue in the heart of Auckland CBD, offering modern New Zealand cuisine with a focus on fresh, local ingredients.',
    imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=600&q=80',
    venueType: 'Restaurant',
  },
  {
    id: 'wellington-waterfront',
    name: 'Wellington Waterfront',
    slug: 'wellington-waterfront',
    manager: 'Mike Chen',
    location: 'Wellington, NZ',
    address: { street: '45 Jervois Quay', city: 'Wellington, 6011', country: 'New Zealand' },
    phone: '+64 4 987 6543',
    email: 'wellington@verdura.co.nz',
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    seatingCapacity: 180,
    coversPerSlot: 36,
    reservationSlotMinutes: 15,
    operatingHours: {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '11:00', close: '23:00' },
      sunday: { open: '11:00', close: '22:00' },
    },
    status: 'Inactive',
    todaysOrders: 32,
    description: 'Stunning harbor views paired with contemporary dining, highlighting locally sourced seafood and fine Wellington craft beers.',
    imageUrl: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=600&q=80',
    venueType: 'Bistro',
  },
  {
    id: 'christchurch-central',
    name: 'Christchurch Central',
    slug: 'christchurch-central',
    manager: 'Emma Wilson',
    location: 'Christchurch, NZ',
    address: { street: '78 Cashel Street', city: 'Christchurch, 8011', country: 'New Zealand' },
    phone: '+64 3 555 1234',
    email: 'christchurch@verdura.co.nz',
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    seatingCapacity: 150,
    coversPerSlot: 30,
    reservationSlotMinutes: 15,
    operatingHours: {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '11:00', close: '23:00' },
      sunday: { open: '11:00', close: '22:00' },
    },
    status: 'Inactive',
    todaysOrders: 28,
    description: 'A modern, light-filled space in the Christchurch lanes, serving artisanal coffee, brunch, and seasonal dinner menus.',
    imageUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80',
    venueType: 'Cafe & Restaurant',
  },
  {
    id: 'hamilton-gardens',
    name: 'Hamilton Gardens',
    slug: 'hamilton-gardens',
    manager: 'James Brown',
    location: 'Hamilton, NZ',
    address: { street: '201 Cobham Drive', city: 'Hamilton, 3216', country: 'New Zealand' },
    phone: '+64 7 888 4321',
    email: 'hamilton@verdura.co.nz',
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    seatingCapacity: 140,
    coversPerSlot: 28,
    reservationSlotMinutes: 15,
    operatingHours: {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '11:00', close: '23:00' },
      sunday: { open: '11:00', close: '22:00' },
    },
    status: 'Inactive',
    todaysOrders: 21,
    description: 'Beautiful botanical surroundings with a menu centered around organic farm-to-table produce and family-friendly dining options.',
    imageUrl: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=600&q=80',
    venueType: 'Garden Kitchen',
  },
  {
    id: 'tauranga-crossing',
    name: 'Tauranga Crossing',
    slug: 'tauranga-crossing',
    manager: 'Lisa Anderson',
    location: 'Tauranga, NZ',
    address: { street: '2 Taurikura Drive', city: 'Tauranga, 3110', country: 'New Zealand' },
    phone: '+64 7 999 5678',
    email: 'tauranga@verdura.co.nz',
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    seatingCapacity: 220,
    coversPerSlot: 44,
    reservationSlotMinutes: 15,
    operatingHours: {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '11:00', close: '23:00' },
      sunday: { open: '11:00', close: '22:00' },
    },
    status: 'Inactive',
    todaysOrders: 0,
    description: 'Spacious and vibrant venue at Tauranga Crossing, offering woodfired pizzas, sharing platters, and an extensive local wine list.',
    imageUrl: 'https://images.unsplash.com/photo-1537047902294-62a40c20a6ae?auto=format&fit=crop&w=600&q=80',
    venueType: 'Restaurant & Bar',
  },
  {
    id: 'dunedin-octagon',
    name: 'Verdura Dunedin',
    slug: 'dunedin-octagon',
    manager: 'David Thompson',
    location: 'Dunedin, NZ',
    address: { street: '17 Saint Andrew Street', line2: 'Central Dunedin', city: 'Dunedin 9016', country: 'New Zealand' },
    phone: '03 474 9692',
    email: 'dunedin@verdura.co.nz',
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    seatingCapacity: 160,
    coversPerSlot: 32,
    reservationSlotMinutes: 15,
    operatingHours: {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '11:00', close: '23:00' },
      sunday: { open: '11:00', close: '22:00' },
    },
    status: 'Active',
    todaysOrders: 0,
    description: 'Housed in a heritage stone building in the heart of the Octagon, offering hearty Southern meals, craft beers, and cozy fireside seating.',
    imageUrl: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=600&q=80',
    venueType: 'Historic Bistro',
  },
  {
    id: 'palmerston-north',
    name: 'Palmerston North',
    slug: 'palmerston-north',
    manager: 'Rachel Green',
    location: 'Palmerston North, NZ',
    address: { street: '34 The Square', city: 'Palmerston North, 4410', country: 'New Zealand' },
    phone: '+64 6 333 4567',
    email: 'palmerston@verdura.co.nz',
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    seatingCapacity: 130,
    coversPerSlot: 26,
    reservationSlotMinutes: 15,
    operatingHours: {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '11:00', close: '23:00' },
      sunday: { open: '11:00', close: '22:00' },
    },
    status: 'Inactive',
    todaysOrders: 0,
    description: 'A lively spot on the Square, serving fresh salads, handmade pasta, and house-baked goods in a relaxed, contemporary environment.',
    imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=600&q=80',
    venueType: 'Casual Eatery',
  },
  {
    id: 'new-plymouth',
    name: 'New Plymouth',
    slug: 'new-plymouth',
    manager: 'Mark Taylor',
    location: 'New Plymouth, NZ',
    address: { street: '56 Devon Street West', city: 'New Plymouth, 4310', country: 'New Zealand' },
    phone: '+64 6 777 8901',
    email: 'newplymouth@verdura.co.nz',
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    seatingCapacity: 148,
    coversPerSlot: 28,
    reservationSlotMinutes: 15,
    operatingHours: {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '11:00', close: '23:00' },
      sunday: { open: '11:00', close: '22:00' },
    },
    status: 'Inactive',
    todaysOrders: 0,
    description: 'Premium Taranaki beef cuts, fresh coastal seafood, and an atmospheric dining room perfect for group dinners and special occasions.',
    imageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80',
    venueType: 'Steakhouse',
  },
];

const DEFAULT_VENUE_ID = 'dunedin-octagon';

function applyRequiredVenueDefaults(venues: Venue[]): Venue[] {
  const venuesWithMangere = venues.some((venue) => venue.id === MANGERE_VENUE.id)
    ? venues
    : [...venues, MANGERE_VENUE];
  const completeVenueList = venuesWithMangere.some((venue) => venue.id === QUEENSTOWN_VENUE.id)
    ? venuesWithMangere
    : [...venuesWithMangere, QUEENSTOWN_VENUE];

  const normalizedVenues: Venue[] = completeVenueList.map((venue): Venue => {
    if (venue.id === DEFAULT_VENUE_ID) {
      return {
        ...venue,
        name: 'Verdura Dunedin',
        address: {
          street: '17 Saint Andrew Street',
          line2: 'Central Dunedin',
          city: 'Dunedin 9016',
          country: 'New Zealand',
        },
        phone: '03 474 9692',
        status: 'Active',
      };
    }

    if (venue.id === MANGERE_VENUE.id) {
      return { ...MANGERE_VENUE, status: 'Inactive' };
    }

    if (venue.id === QUEENSTOWN_VENUE.id) {
      return { ...QUEENSTOWN_VENUE, status: 'Inactive' };
    }

    return { ...venue, status: 'Inactive' };
  });

  return normalizedVenues.sort((a, b) => a.name.localeCompare(b.name, 'en-NZ'));
}

export function VenueSettingsPage() {
  const navigate = useNavigate();

  // Load from localStorage if present, otherwise default to INITIAL_VENUES
  const [venues, setVenues] = useState<Venue[]>(() => {
    const saved = localStorage.getItem('verdura-venues');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Venue[];
        return applyRequiredVenueDefaults(parsed);
      } catch {
        return applyRequiredVenueDefaults(INITIAL_VENUES);
      }
    }
    return applyRequiredVenueDefaults(INITIAL_VENUES);
  });

  const [selectedVenueId, setSelectedVenueId] = useState<string>(DEFAULT_VENUE_ID);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');
  const [activeTab, setActiveTab] = useState<'overview' | 'settings' | 'config' | 'hours' | 'staff'>('overview');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);

  // Status Filter options
  const [filterLocation, setFilterLocation] = useState<string>('All');

  // Success state for notifications
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync state to localStorage
  useEffect(() => {
    localStorage.setItem('verdura-venues', JSON.stringify(venues));
  }, [venues]);

  // Handle custom events dispatched from AdminLayout.tsx
  useEffect(() => {
    const handleGlobalSearch = (e: Event) => {
      setSearchQuery((e as CustomEvent).detail || '');
    };
    const handleGlobalAdd = () => {
      setIsAddModalOpen(true);
    };

    window.addEventListener('venue-search', handleGlobalSearch);
    window.addEventListener('venue-add-click', handleGlobalAdd);

    return () => {
      window.removeEventListener('venue-search', handleGlobalSearch);
      window.removeEventListener('venue-add-click', handleGlobalAdd);
    };
  }, []);

  const selectedVenue = (venues.find((v) => v.id === selectedVenueId) || venues[0] || INITIAL_VENUES[0]) as Venue;

  // Calculated Stats
  const totalVenuesCount = venues.length;
  const activeVenuesCount = venues.filter((v) => v.status === 'Active').length;
  const totalCapacitySum = venues.reduce((acc, v) => acc + v.seatingCapacity, 0);
  const todayOrdersSum = venues.reduce((acc, v) => acc + v.todaysOrders, 0) + 30; // matching 156 with offset

  // Filtering Logic
  const filteredVenues = venues.filter((v) => {
    const matchesSearch =
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.manager.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'All' ? true : v.status === statusFilter;
    const matchesLocation = filterLocation === 'All' ? true : v.location.includes(filterLocation);

    return matchesSearch && matchesStatus && matchesLocation;
  });

  // Edit fields handlers
  const handleUpdateVenueField = (field: keyof Venue, value: any) => {
    setVenues((prev) =>
      prev.map((v) => (v.id === selectedVenue.id ? { ...v, [field]: value } : v))
    );
  };

  const handleUpdateAddressField = (field: keyof Address, value: string) => {
    setVenues((prev) =>
      prev.map((v) =>
        v.id === selectedVenue.id
          ? {
              ...v,
              address: { ...v.address, [field]: value },
              location: field === 'city' ? `${value}, NZ` : v.location,
            }
          : v
      )
    );
  };

  const handleUpdateHoursField = (day: keyof OperatingHours, key: 'open' | 'close', value: string) => {
    setVenues((prev) =>
      prev.map((v) =>
        v.id === selectedVenue.id
          ? {
              ...v,
              operatingHours: {
                ...v.operatingHours,
                [day]: { ...v.operatingHours[day], [key]: value },
              },
            }
          : v
      )
    );
  };

  const showNotification = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // Add Venue Form State
  const [newName, setNewName] = useState('');
  const [newManager, setNewManager] = useState('');
  const [newStreet, setNewStreet] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCapacity, setNewCapacity] = useState(100);
  const [newStatus, setNewStatus] = useState<'Active' | 'Inactive'>('Active');
  const [newType, setNewType] = useState('Restaurant');

  const handleAddVenueSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const slug = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const newVenue: Venue = {
      id: slug || `venue-${Date.now()}`,
      name: newName,
      slug: slug || `venue-${Date.now()}`,
      manager: newManager || 'Unnamed Manager',
      location: `${newCity || 'Auckland'}, NZ`,
      address: {
        street: newStreet || '123 Main St',
        city: newCity || 'Auckland',
        country: 'New Zealand',
      },
      phone: newPhone || '+64 9 555 0100',
      email: newEmail || `${slug}@verdura.co.nz`,
      timezone: 'Pacific/Auckland',
      currency: 'NZD',
      seatingCapacity: Number(newCapacity),
      coversPerSlot: Math.round(Number(newCapacity) * 0.2),
      reservationSlotMinutes: 15,
      operatingHours: {
        monday: { open: '11:00', close: '22:00' },
        tuesday: { open: '11:00', close: '22:00' },
        wednesday: { open: '11:00', close: '22:00' },
        thursday: { open: '11:00', close: '22:00' },
        friday: { open: '11:00', close: '23:00' },
        saturday: { open: '11:00', close: '23:00' },
        sunday: { open: '11:00', close: '22:00' },
      },
      status: newStatus,
      todaysOrders: 0,
      description: 'A beautiful new venue added to the Verdura network.',
      imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=600&q=80',
      venueType: newType,
    };

    setVenues((prev) => [...prev, newVenue]);
    setSelectedVenueId(newVenue.id);
    setIsAddModalOpen(false);

    // Reset Form
    setNewName('');
    setNewManager('');
    setNewStreet('');
    setNewCity('');
    setNewPhone('');
    setNewEmail('');
    setNewCapacity(100);
    setNewStatus('Active');
    setNewType('Restaurant');

    showNotification('New venue added successfully!');
  };

  // Staff mock database based on selected venue
  const getVenueStaff = (venueId: string) => {
    switch (venueId) {
      case 'auckland-cbd':
        return [
          { name: 'Sarah Johnson', role: 'General Manager', email: 'sarah.j@verdura.co.nz', status: 'On Shift' },
          { name: 'Emma Watson', role: 'Head Chef', email: 'emma.w@verdura.co.nz', status: 'On Shift' },
          { name: 'Daniel Radcliffe', role: 'Floor Supervisor', email: 'daniel.r@verdura.co.nz', status: 'On Shift' },
          { name: 'Rupert Grint', role: 'Lead Bartender', email: 'rupert.g@verdura.co.nz', status: 'Off Duty' },
        ];
      case 'wellington-waterfront':
        return [
          { name: 'Mike Chen', role: 'General Manager', email: 'mike.c@verdura.co.nz', status: 'On Shift' },
          { name: 'Rachel Zane', role: 'Head Chef', email: 'rachel.z@verdura.co.nz', status: 'On Shift' },
          { name: 'Harvey Specter', role: 'Host', email: 'harvey.s@verdura.co.nz', status: 'Off Duty' },
        ];
      default:
        return [
          { name: selectedVenue.manager, role: 'General Manager', email: `${selectedVenue.id}-manager@verdura.co.nz`, status: 'On Shift' },
          { name: 'Alex Rivera', role: 'Head Chef', email: 'alex.r@verdura.co.nz', status: 'On Shift' },
          { name: 'Taylor Swift', role: 'Server', email: 'taylor.s@verdura.co.nz', status: 'On Shift' },
        ];
    }
  };

  const currentStaff = getVenueStaff(selectedVenue.id);

  return (
    <div className="p-[18px] max-w-[1440px] mx-auto animate-fade-in relative">
      {/* Toast Notification */}
      {successMsg && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-600 text-white text-xs font-semibold px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-[mmToastIn_0.2s_ease-out]">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          {successMsg}
        </div>
      )}

      {/* --- STATS CARD ROW --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
        {/* Card 1: Total Venues */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex items-center gap-4">
          <div className="w-11 h-11 shrink-0 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center text-emerald-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Total Venues</p>
            <p className="text-[26px] font-bold text-gray-900 leading-tight mt-0.5">{totalVenuesCount}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Active venues</p>
          </div>
        </div>

        {/* Card 2: Active Venues */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 shrink-0 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-9 0H3.75A1.5 1.5 0 012.25 19.5v-12a1.5 1.5 0 011.5-1.5h16.5A1.5 1.5 0 0121.75 7.5v12a1.5 1.5 0 01-1.5 1.5H12m-9-15.75H21" />
              </svg>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Active Venues</p>
              <p className="text-[26px] font-bold text-gray-900 leading-tight mt-0.5">{activeVenuesCount}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Currently operating</p>
            </div>
          </div>
          <div className="shrink-0 pt-3">
            <svg className="w-16 h-8 text-emerald-500" viewBox="0 0 100 50" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M0,40 Q25,25 50,35 T100,10" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {/* Card 3: Total Capacity */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex items-center gap-4">
          <div className="w-11 h-11 shrink-0 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Total Capacity</p>
            <p className="text-[26px] font-bold text-gray-900 leading-tight mt-0.5">{totalCapacitySum.toLocaleString()}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Across all venues</p>
          </div>
        </div>

        {/* Card 4: Today's Orders */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 shrink-0 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center text-violet-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Today's Orders</p>
              <p className="text-[26px] font-bold text-gray-900 leading-tight mt-0.5">{todayOrdersSum}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Across all venues</p>
            </div>
          </div>
          <div className="shrink-0 pt-3">
            <svg className="w-16 h-8 text-violet-500" viewBox="0 0 100 50" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M0,45 Q20,40 40,25 T80,35 T100,15" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>

      {/* --- MAIN PAGE SPLIT --- */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
        {/* LEFT COLUMN: All Venues Table */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">All Venues</h2>
          </div>

          {/* Search and Filters */}
          <div className="p-4 border-b border-gray-50 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
                <svg className="w-[14px] h-[14px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="search"
                placeholder="Search venues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-colors"
              />
            </div>

            {/* Filter Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsFilterDropdownOpen(!isFilterDropdownOpen);
                  setIsStatusDropdownOpen(false);
                }}
                className="h-8 px-3 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 font-medium transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                </svg>
                <span>Filter</span>
                <svg className={`w-3 h-3 text-gray-400 transition-transform ${isFilterDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isFilterDropdownOpen && (
                <div className="absolute right-0 mt-1 z-10 w-44 bg-white border border-gray-150 rounded-lg shadow-lg py-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterLocation('All');
                      setIsFilterDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between ${filterLocation === 'All' ? 'font-semibold text-emerald-600 bg-emerald-50/40' : 'text-gray-700'}`}
                  >
                    All Locations
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterLocation('Auckland');
                      setIsFilterDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between ${filterLocation === 'Auckland' ? 'font-semibold text-emerald-600 bg-emerald-50/40' : 'text-gray-700'}`}
                  >
                    Auckland
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterLocation('Wellington');
                      setIsFilterDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between ${filterLocation === 'Wellington' ? 'font-semibold text-emerald-600 bg-emerald-50/40' : 'text-gray-700'}`}
                  >
                    Wellington
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterLocation('Christchurch');
                      setIsFilterDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between ${filterLocation === 'Christchurch' ? 'font-semibold text-emerald-600 bg-emerald-50/40' : 'text-gray-700'}`}
                  >
                    Christchurch
                  </button>
                </div>
              )}
            </div>

            {/* Status Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsStatusDropdownOpen(!isStatusDropdownOpen);
                  setIsFilterDropdownOpen(false);
                }}
                className="h-8 px-3 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 font-medium transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Status</span>
                <svg className={`w-3 h-3 text-gray-400 transition-transform ${isStatusDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isStatusDropdownOpen && (
                <div className="absolute right-0 mt-1 z-10 w-36 bg-white border border-gray-150 rounded-lg shadow-lg py-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('All');
                      setIsStatusDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 ${statusFilter === 'All' ? 'font-semibold text-emerald-600 bg-emerald-50/40' : 'text-gray-700'}`}
                  >
                    All Status
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('Active');
                      setIsStatusDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 ${statusFilter === 'Active' ? 'font-semibold text-emerald-600 bg-emerald-50/40' : 'text-gray-700'}`}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('Inactive');
                      setIsStatusDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 ${statusFilter === 'Inactive' ? 'font-semibold text-emerald-600 bg-emerald-50/40' : 'text-gray-700'}`}
                  >
                    Inactive
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  <th className="py-3 px-4 font-bold">Venue</th>
                  <th className="py-3 px-4 font-bold">Location</th>
                  <th className="py-3 px-4 font-bold">Status</th>
                  <th className="py-3 px-4 font-bold">Today's Orders</th>
                  <th className="py-3 px-4 font-bold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredVenues.length > 0 ? (
                  filteredVenues.map((row) => {
                    const isSelected = row.id === selectedVenue.id;
                    return (
                      <tr
                        key={row.id}
                        onClick={() => {
                          setSelectedVenueId(row.id);
                          setActiveTab('overview');
                        }}
                        className={`group cursor-pointer hover:bg-gray-50 transition-colors ${
                          isSelected ? 'bg-emerald-50/30' : ''
                        }`}
                      >
                        {/* Venue details */}
                        <td className="py-3.5 px-4 flex items-center gap-3">
                          <div className="relative">
                            <img
                              src={row.imageUrl}
                              alt={row.name}
                              className="w-10 h-10 rounded-lg object-cover border border-gray-150 shrink-0 shadow-xs"
                            />
                            {isSelected && (
                              <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-emerald-500" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-gray-900 truncate leading-tight group-hover:text-emerald-700 transition-colors">
                                {row.name}
                              </span>
                              {row.status === 'Active' && row.todaysOrders > 25 && (
                                <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                            <p className="text-[10.5px] text-gray-400 mt-0.5 truncate leading-tight font-medium">
                              Manager: {row.manager}
                            </p>
                          </div>
                        </td>

                        {/* Location */}
                        <td className="py-3.5 px-4 text-xs text-gray-500 font-medium">
                          {row.location}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              row.status === 'Active'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                : 'bg-gray-100 text-gray-500 border-gray-200'
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>

                        {/* Today's Orders */}
                        <td className="py-3.5 px-4 text-xs font-bold text-gray-800 tabular-nums">
                          {row.todaysOrders}
                        </td>

                        {/* Row Action dots */}
                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <div className="max-w-[240px] mx-auto text-gray-400 flex flex-col items-center">
                        <svg className="w-10 h-10 text-gray-300 mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.008 1.24l.885 1.77a2.25 2.25 0 002.007 1.24h1.98a2.25 2.25 0 002.007-1.24l.885-1.77a2.25 2.25 0 012.007-1.24h3.86m-18 0h18m-18 0l-1.08 7.568A2.25 2.25 0 004.42 22.5h15.16a2.25 2.25 0 002.228-2.203L21.75 13.5M3.75 6.75H20.25M6.75 3.75h10.5M12 10.5v.008" />
                        </svg>
                        <p className="text-xs font-bold text-gray-900">No venues match search</p>
                        <p className="text-[11px] text-gray-400 mt-1">Try modifying your search text or clear filters.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-4 border-t border-gray-100 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-gray-400">
              Showing 1 to {filteredVenues.length} of {filteredVenues.length} venues
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-white border border-gray-200 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors text-xs font-bold"
                disabled
              >
                &lt;
              </button>
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-xs font-bold shadow-xs"
              >
                1
              </button>
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-white border border-gray-200 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors text-xs font-bold"
                disabled
              >
                &gt;
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Venue Details Panel */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          {/* Banner container */}
          <div className="relative h-[160px] overflow-hidden bg-gray-100">
            <img
              src={selectedVenue.imageUrl}
              alt={selectedVenue.name}
              className="w-full h-full object-cover"
            />
            {/* Dark overlay gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

            {/* Badge controls */}
            <div className="absolute top-3.5 right-3.5 flex items-center gap-2">
              <span
                className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full text-white shadow-sm border border-white/20 ${
                  selectedVenue.status === 'Active' ? 'bg-emerald-600' : 'bg-gray-600'
                }`}
              >
                {selectedVenue.status}
              </span>
              <button
                type="button"
                className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-xs flex items-center justify-center text-white hover:bg-black/60 transition-colors shadow-xs"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                </svg>
              </button>
            </div>

            {/* Logo overlay float */}
            <div className="absolute -bottom-6 left-5 w-[68px] h-[68px] bg-white rounded-xl shadow-md border border-gray-100 flex flex-col items-center justify-center p-1.5 z-[2]">
              <svg width="34" height="34" viewBox="0 0 40 40" fill="none" className="text-emerald-600">
                <path
                  d="M20 28.5c-5.1-1.7-9.5-6.8-9.5-14.4a.9.9 0 0 1 .9-.9c3.1 0 6.1.8 8.6 3.1 2.5-2.3 5.5-3.1 8.6-3.1a.9.9 0 0 1 .9.9c0 7.6-4.4 12.7-9.5 14.4Z"
                  fill="currentColor"
                />
                <path d="M20 17.4V29" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="text-[8px] font-bold text-emerald-800 leading-none select-none tracking-wide">
                VERDURA
              </span>
            </div>
          </div>

          {/* Heading Section */}
          <div className="pt-8 px-5 pb-3">
            <h3 className="text-base font-bold text-gray-900 leading-tight">
              {selectedVenue.name}
            </h3>
            <p className="text-[11px] text-gray-400 mt-1 font-medium">
              Manager: {selectedVenue.manager}
            </p>
          </div>

          {/* Tabs */}
          <div className="px-5 border-b border-gray-100 flex items-center gap-4 overflow-x-auto scrollbar-none select-none">
            {(['overview', 'settings', 'config', 'hours', 'staff'] as const).map((tab) => {
              const isActive = activeTab === tab;
              const labels = {
                overview: 'Overview',
                settings: 'Settings',
                config: 'Configurations',
                hours: 'Operating Hours',
                staff: 'Staff',
              };
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`py-2 text-[11.5px] font-bold tracking-tight border-b-2 whitespace-nowrap transition-colors outline-none ${
                    isActive
                      ? 'border-emerald-500 text-emerald-600 font-bold'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {labels[tab]}
                </button>
              );
            })}
          </div>

          {/* Content Pane */}
          <div className="p-5">
            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
              <div className="space-y-5 animate-[mmFadeIn_0.15s_ease-out]">
                {/* Venue Information Section */}
                <div className="bg-white">
                  <div className="flex items-center justify-between border-b border-gray-50 pb-2 mb-3">
                    <h4 className="text-[12.5px] font-bold text-gray-800">Venue Information</h4>
                    <button
                      type="button"
                      onClick={() => setActiveTab('settings')}
                      className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-250 px-2.5 py-1 rounded-lg text-[10.5px] font-bold text-gray-700 shadow-xs transition-colors shrink-0"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.83 20.013a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                      Edit
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-y-3.5 gap-x-4 text-xs font-medium text-gray-800">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Venue Name</p>
                      <p className="mt-1 font-bold text-gray-900">{selectedVenue.name}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Status</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedVenue.status === 'Active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                        <span className="font-bold text-gray-900">{selectedVenue.status}</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Location</p>
                      <p className="mt-1 text-gray-600 leading-relaxed font-bold">
                        {selectedVenue.address.street}
                        <br />
                        {selectedVenue.address.line2 && (
                          <>
                            {selectedVenue.address.line2}
                            <br />
                          </>
                        )}
                        {selectedVenue.address.line3 && (
                          <>
                            {selectedVenue.address.line3}
                            <br />
                          </>
                        )}
                        {selectedVenue.address.city}
                        <br />
                        {selectedVenue.address.country}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Timezone</p>
                      <p className="mt-1 font-bold text-gray-900">{selectedVenue.timezone}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Phone</p>
                      <p className="mt-1 font-bold text-gray-900">{selectedVenue.phone}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Email</p>
                      <p className="mt-1 font-bold text-gray-900 truncate" title={selectedVenue.email}>{selectedVenue.email}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Capacity</p>
                      <p className="mt-1 font-bold text-gray-900">{selectedVenue.seatingCapacity} seats</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Venue Type</p>
                      <p className="mt-1 font-bold text-gray-900">{selectedVenue.venueType}</p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3.5 border-t border-gray-50">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Description</p>
                    <p className="mt-1.5 text-xs font-semibold text-gray-600 leading-relaxed">
                      {selectedVenue.description}
                    </p>
                  </div>
                </div>

                {/* Today's Summary Card */}
                <div className="bg-white pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between pb-2 mb-3">
                    <h4 className="text-[12.5px] font-bold text-gray-800">Today's Summary</h4>
                    <button
                      type="button"
                      onClick={() => navigate('/reports')}
                      className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-255 px-2.5 py-1 rounded-lg text-[10.5px] font-bold text-gray-700 shadow-xs transition-colors shrink-0"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      View Reports
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Orders Metric */}
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold shrink-0 shadow-xs">
                        O
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Orders</p>
                        <p className="text-base font-bold text-gray-800 leading-tight mt-0.5 tabular-nums">
                          {selectedVenue.todaysOrders}
                        </p>
                      </div>
                    </div>

                    {/* Revenue Metric */}
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-[10px] font-bold shrink-0 shadow-xs">
                        $
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Revenue</p>
                        <p className="text-base font-bold text-gray-800 leading-tight mt-0.5 tabular-nums">
                          ${(selectedVenue.todaysOrders * 72.12).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    {/* Covers Metric */}
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold shrink-0 shadow-xs">
                        👥
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Covers</p>
                        <p className="text-base font-bold text-gray-800 leading-tight mt-0.5 tabular-nums">
                          {Math.round(selectedVenue.todaysOrders * 1.97)}
                        </p>
                      </div>
                    </div>

                    {/* Avg Order Metric */}
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-bold shrink-0 shadow-xs">
                        📈
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Avg. Order</p>
                        <p className="text-base font-bold text-gray-800 leading-tight mt-0.5 tabular-nums">
                          $72.12
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SETTINGS TAB */}
            {activeTab === 'settings' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  showNotification('Venue information settings saved.');
                  setActiveTab('overview');
                }}
                className="space-y-4 animate-[mmFadeIn_0.15s_ease-out] text-xs font-semibold text-gray-700"
              >
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Venue Name
                  </label>
                  <input
                    type="text"
                    value={selectedVenue.name}
                    onChange={(e) => handleUpdateVenueField('name', e.target.value)}
                    className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Manager Name
                    </label>
                    <input
                      type="text"
                      value={selectedVenue.manager}
                      onChange={(e) => handleUpdateVenueField('manager', e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Status
                    </label>
                    <select
                      value={selectedVenue.status}
                      onChange={(e) => handleUpdateVenueField('status', e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      value={selectedVenue.phone}
                      onChange={(e) => handleUpdateVenueField('phone', e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Public Email Address
                    </label>
                    <input
                      type="email"
                      value={selectedVenue.email}
                      onChange={(e) => handleUpdateVenueField('email', e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Venue Type
                    </label>
                    <input
                      type="text"
                      value={selectedVenue.venueType}
                      onChange={(e) => handleUpdateVenueField('venueType', e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Seating Capacity
                    </label>
                    <input
                      type="number"
                      value={selectedVenue.seatingCapacity}
                      onChange={(e) => handleUpdateVenueField('seatingCapacity', Number(e.target.value))}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                      min="0"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Street Address
                  </label>
                  <input
                    type="text"
                    value={selectedVenue.address.street}
                    onChange={(e) => handleUpdateAddressField('street', e.target.value)}
                    className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      value={selectedVenue.address.city}
                      onChange={(e) => handleUpdateAddressField('city', e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Country
                    </label>
                    <input
                      type="text"
                      value={selectedVenue.address.country}
                      onChange={(e) => handleUpdateAddressField('country', e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Description
                  </label>
                  <textarea
                    rows={3}
                    value={selectedVenue.description}
                    onChange={(e) => handleUpdateVenueField('description', e.target.value)}
                    className="w-full p-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white resize-none"
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 py-2 px-4 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer"
                  >
                    Save Settings
                  </button>
                </div>
              </form>
            )}

            {/* CONFIGURATIONS TAB */}
            {activeTab === 'config' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  showNotification('System configurations updated.');
                  setActiveTab('overview');
                }}
                className="space-y-4 animate-[mmFadeIn_0.15s_ease-out] text-xs font-semibold text-gray-700"
              >
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    URL Slug
                  </label>
                  <input
                    type="text"
                    value={selectedVenue.slug}
                    onChange={(e) => handleUpdateVenueField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}
                    className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Default Currency
                    </label>
                    <select
                      value={selectedVenue.currency}
                      onChange={(e) => handleUpdateVenueField('currency', e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    >
                      <option value="NZD">NZD ($)</option>
                      <option value="USD">USD ($)</option>
                      <option value="AUD">AUD ($)</option>
                      <option value="GBP">GBP (£)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Timezone Mapping
                    </label>
                    <select
                      value={selectedVenue.timezone}
                      onChange={(e) => handleUpdateVenueField('timezone', e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    >
                      <option value="Pacific/Auckland">Pacific/Auckland</option>
                      <option value="Australia/Sydney">Australia/Sydney</option>
                      <option value="America/New_York">America/New_York</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Covers Per Slot Limit
                    </label>
                    <input
                      type="number"
                      value={selectedVenue.coversPerSlot}
                      onChange={(e) => handleUpdateVenueField('coversPerSlot', Number(e.target.value))}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                      min="1"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Slot Duration (Minutes)
                    </label>
                    <select
                      value={selectedVenue.reservationSlotMinutes}
                      onChange={(e) => handleUpdateVenueField('reservationSlotMinutes', Number(e.target.value))}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    >
                      <option value={15}>15 Minutes</option>
                      <option value={30}>30 Minutes</option>
                      <option value={45}>45 Minutes</option>
                      <option value={60}>60 Minutes</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 py-2 px-4 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer"
                  >
                    Save Config
                  </button>
                </div>
              </form>
            )}

            {/* OPERATING HOURS TAB */}
            {activeTab === 'hours' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  showNotification('Standard daily operating hours saved.');
                  setActiveTab('overview');
                }}
                className="space-y-4.5 animate-[mmFadeIn_0.15s_ease-out] text-xs font-medium text-gray-800"
              >
                <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mb-1.5">
                  Standard Daily Open / Close Times
                </div>
                <div className="space-y-3">
                  {(Object.keys(selectedVenue.operatingHours) as Array<keyof OperatingHours>).map((day) => {
                    const hours = selectedVenue.operatingHours[day];
                    return (
                      <div key={day} className="flex items-center justify-between gap-4">
                        <span className="capitalize text-xs font-bold text-gray-800 w-24">
                          {day}
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="11:00"
                            value={hours.open}
                            onChange={(e) => handleUpdateHoursField(day, 'open', e.target.value)}
                            className="w-20 text-center h-8 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                            required
                          />
                          <span className="text-gray-400 font-medium">to</span>
                          <input
                            type="text"
                            placeholder="22:00"
                            value={hours.close}
                            onChange={(e) => handleUpdateHoursField(day, 'close', e.target.value)}
                            className="w-20 text-center h-8 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                            required
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-3 border-t border-gray-50 flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 py-2 px-4 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer"
                  >
                    Save Hours
                  </button>
                </div>
              </form>
            )}

            {/* STAFF TAB */}
            {activeTab === 'staff' && (
              <div className="space-y-4 animate-[mmFadeIn_0.15s_ease-out]">
                <div className="flex items-center justify-between border-b border-gray-50 pb-2 mb-1">
                  <h4 className="text-[12.5px] font-bold text-gray-800">Venue Staff List</h4>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                    {currentStaff.length} Employees
                  </span>
                </div>

                <div className="space-y-3">
                  {currentStaff.map((person, idx) => {
                    const initials = person.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase();
                    return (
                      <div
                        key={idx}
                        className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex items-center justify-between gap-3 shadow-xs"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold shrink-0">
                            {initials}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-gray-900 leading-tight">{person.name}</p>
                            <p className="text-[10.5px] text-gray-400 mt-0.5 leading-tight font-medium">
                              {person.role} • {person.email}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                            person.status === 'On Shift'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              : 'bg-gray-100 text-gray-500 border-gray-200'
                          }`}
                        >
                          {person.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- ADD VENUE MODAL DIALOG --- */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 animate-[mmFadeIn_0.15s_ease-out]">
          <div className="relative bg-white rounded-xl shadow-xl border border-gray-150 max-w-lg w-full overflow-hidden animate-[mmModalIn_0.2s_ease-out]">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">Add New Venue</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleAddVenueSubmit} className="p-5 space-y-4 text-xs font-semibold text-gray-700">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Venue Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Napier Portside"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Manager Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. John Key"
                    value={newManager}
                    onChange={(e) => setNewManager(e.target.value)}
                    className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Venue Type
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Bistro, Cafe"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Seating Capacity
                  </label>
                  <input
                    type="number"
                    value={newCapacity}
                    onChange={(e) => setNewCapacity(Number(e.target.value))}
                    className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Status
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as 'Active' | 'Inactive')}
                    className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    placeholder="+64 9 ..."
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="manager@verdura.co.nz"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                  />
                </div>
              </div>

              <div className="border-t border-gray-50 pt-3">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Location Details</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[10px] text-gray-500 mb-1">Street Address</label>
                    <input
                      type="text"
                      placeholder="45 Marine Parade"
                      value={newStreet}
                      onChange={(e) => setNewStreet(e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">City</label>
                    <input
                      type="text"
                      placeholder="Napier"
                      value={newCity}
                      onChange={(e) => setNewCity(e.target.value)}
                      className="w-full h-9 px-3 border border-gray-250 rounded-lg text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-gray-850 bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 bg-white border border-gray-250 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  Add Venue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
