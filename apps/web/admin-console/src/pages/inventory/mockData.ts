import { InventoryItem, PurchaseOrder, Supplier, StockMovement, Recipe, StocktakeRecord, InventoryTransfer } from './types';

// Let's create realistic items that can be referenced in recipes
export const initialItems: InventoryItem[] = [
  {
    id: 'inv-1',
    name: 'Chicken Breast',
    sku: 'CHB-001',
    category: 'Raw Meat',
    supplier: 'Fresh Foods Ltd',
    venue: 'All Venues',
    onHand: 42,
    min: 40,
    max: 120,
    unit: 'kg',
    daysLeft: 5,
    avgUsage: 9,
    cost: 12.50,
    status: 'Healthy',
    updated: '1 min ago',
    expiredQty: 0,
    batches: [
      { id: 'b-chb-1', batchNumber: 'CHB-B01', supplier: 'Fresh Foods Ltd', receivedDate: '2026-06-28', expiryDate: '2026-07-06', quantity: 22 },
      { id: 'b-chb-2', batchNumber: 'CHB-B02', supplier: 'Fresh Foods Ltd', receivedDate: '2026-07-02', expiryDate: '2026-07-10', quantity: 20 }
    ],
    batchNumber: 'CHB-B01',
    expiryDate: '2026-07-06',
    expectedStock: 45,
    actualStock: 42,
    wasteStock: 2,
    varianceQty: -1,
    varianceCost: -12.50
  },
  {
    id: 'inv-2',
    name: 'Lamb Shank',
    sku: 'LMB-002',
    category: 'Raw Meat',
    supplier: 'Fresh Foods Ltd',
    venue: 'All Venues',
    onHand: 18,
    min: 50,
    max: 100,
    unit: 'kg',
    daysLeft: 2,
    avgUsage: 9,
    cost: 18.90,
    status: 'Low Stock',
    updated: '5 min ago',
    expiredQty: 0,
    batches: [
      { id: 'b-lmb-1', batchNumber: 'LMB-B01', supplier: 'Fresh Foods Ltd', receivedDate: '2026-06-28', expiryDate: '2026-07-10', quantity: 18 }
    ],
    batchNumber: 'LMB-B01',
    expiryDate: '2026-07-10',
    expectedStock: 20,
    actualStock: 18,
    wasteStock: 0,
    varianceQty: -2,
    varianceCost: -37.80
  },
  {
    id: 'inv-3',
    name: 'Olive Oil Extra Virgin',
    sku: 'OIL-001',
    category: 'Oils & Fats',
    supplier: 'Mediterranean Imports',
    venue: 'All Venues',
    onHand: 5,
    min: 20,
    max: 60,
    unit: 'bottles',
    daysLeft: 1,
    avgUsage: 5,
    cost: 16.20,
    status: 'Low Stock',
    updated: '10 min ago',
    expiredQty: 0,
    batches: [
      { id: 'b-oil-1', batchNumber: 'OIL-B01', supplier: 'Mediterranean Imports', receivedDate: '2026-06-25', expiryDate: '2026-08-25', quantity: 5 }
    ],
    batchNumber: 'OIL-B01',
    expiryDate: '2026-08-25',
    expectedStock: 5,
    actualStock: 5,
    wasteStock: 0,
    varianceQty: 0,
    varianceCost: 0
  },
  {
    id: 'inv-4',
    name: 'Pita Bread',
    sku: 'PITA-001',
    category: 'Bakery',
    supplier: 'Bakery Co.',
    venue: 'All Venues',
    onHand: 0,
    min: 30,
    max: 90,
    unit: 'packs',
    daysLeft: 0,
    avgUsage: 10,
    cost: 2.80,
    status: 'Zero Stock',
    updated: '15 min ago',
    expiredQty: 8,
    batches: [],
    expectedStock: 5,
    actualStock: 0,
    wasteStock: 5,
    varianceQty: 0,
    varianceCost: 0
  },
  {
    id: 'inv-5',
    name: 'Greek Yogurt',
    sku: 'YOG-001',
    category: 'Dairy',
    supplier: 'Dairy Fresh',
    venue: 'All Venues',
    onHand: 25,
    min: 15,
    max: 60,
    unit: 'kg',
    daysLeft: 5,
    avgUsage: 5,
    cost: 4.90,
    status: 'Healthy',
    updated: '18 min ago',
    expiredQty: 0,
    batches: [
      { id: 'b-yog-1', batchNumber: 'YOG-B01', supplier: 'Dairy Fresh', receivedDate: '2026-06-30', expiryDate: '2026-07-07', quantity: 15 },
      { id: 'b-yog-2', batchNumber: 'YOG-B02', supplier: 'Dairy Fresh', receivedDate: '2026-07-02', expiryDate: '2026-07-14', quantity: 10 }
    ],
    batchNumber: 'YOG-B01',
    expiryDate: '2026-07-07',
    expectedStock: 25,
    actualStock: 25,
    wasteStock: 0,
    varianceQty: 0,
    varianceCost: 0
  },
  {
    id: 'inv-6',
    name: 'Feta Cheese',
    sku: 'FETA-001',
    category: 'Dairy',
    supplier: 'Mediterranean Imports',
    venue: 'All Venues',
    onHand: 12,
    min: 10,
    max: 30,
    unit: 'kg',
    daysLeft: 6,
    avgUsage: 3,
    cost: 9.80,
    status: 'Healthy',
    updated: '25 min ago',
    expiredQty: 2,
    batches: [
      { id: 'b-feta-1', batchNumber: 'FETA-B01', supplier: 'Mediterranean Imports', receivedDate: '2026-06-25', expiryDate: '2026-07-02', quantity: 12 }
    ],
    batchNumber: 'FETA-B01',
    expiryDate: '2026-07-02',
    expectedStock: 13,
    actualStock: 12,
    wasteStock: 1,
    varianceQty: 0,
    varianceCost: 0
  },
  {
    id: 'inv-7',
    name: 'Tomatoes',
    sku: 'TOM-001',
    category: 'Vegetables',
    supplier: 'Green Valley',
    venue: 'All Venues',
    onHand: 8,
    min: 25,
    max: 100,
    unit: 'kg',
    daysLeft: 1,
    avgUsage: 8,
    cost: 3.20,
    status: 'Low Stock',
    updated: '30 min ago',
    expiredQty: 5,
    batches: [
      { id: 'b-tom-1', batchNumber: 'TOM-B01', supplier: 'Green Valley', receivedDate: '2026-06-24', expiryDate: '2026-07-01', quantity: 8 }
    ],
    batchNumber: 'TOM-B01',
    expiryDate: '2026-07-01',
    expectedStock: 12,
    actualStock: 8,
    wasteStock: 3,
    varianceQty: -1,
    varianceCost: -3.20
  },
  {
    id: 'inv-8',
    name: 'Red Onion',
    sku: 'ONI-001',
    category: 'Vegetables',
    supplier: 'Green Valley',
    venue: 'All Venues',
    onHand: 35,
    min: 20,
    max: 80,
    unit: 'kg',
    daysLeft: 7,
    avgUsage: 6,
    cost: 2.40,
    status: 'Healthy',
    updated: '32 min ago',
    expiredQty: 0,
    batches: [
      { id: 'b-oni-1', batchNumber: 'ONI-B01', supplier: 'Green Valley', receivedDate: '2026-06-28', expiryDate: '2026-07-05', quantity: 35 }
    ],
    batchNumber: 'ONI-B01',
    expiryDate: '2026-07-05',
    expectedStock: 35,
    actualStock: 35,
    wasteStock: 0,
    varianceQty: 0,
    varianceCost: 0
  },
  // Extra items for complete recipes and ingredients mapping
  {
    id: 'inv-9',
    name: 'Beef Patty (150g)',
    sku: 'BEEF-001',
    category: 'Raw Meat',
    supplier: 'Fresh Foods Ltd',
    venue: 'All Venues',
    onHand: 150,
    min: 100,
    max: 400,
    unit: 'units',
    daysLeft: 3,
    avgUsage: 45,
    cost: 1.80,
    status: 'Healthy',
    updated: '40 min ago',
    batches: [
      { id: 'b-beef-1', batchNumber: 'BEEF-B01', supplier: 'Fresh Foods Ltd', receivedDate: '2026-06-30', expiryDate: '2026-07-08', quantity: 150 }
    ],
    batchNumber: 'BEEF-B01',
    expiryDate: '2026-07-08'
  },
  {
    id: 'inv-10',
    name: 'Burger Bun',
    sku: 'BUN-001',
    category: 'Bakery',
    supplier: 'Bakery Co.',
    venue: 'All Venues',
    onHand: 120,
    min: 80,
    max: 300,
    unit: 'units',
    daysLeft: 2,
    avgUsage: 50,
    cost: 0.45,
    status: 'Healthy',
    updated: '45 min ago',
    batches: [
      { id: 'b-bun-1', batchNumber: 'BUN-B01', supplier: 'Bakery Co.', receivedDate: '2026-07-01', expiryDate: '2026-07-05', quantity: 120 }
    ],
    batchNumber: 'BUN-B01',
    expiryDate: '2026-07-05'
  },
  {
    id: 'inv-11',
    name: 'Special Burger Sauce',
    sku: 'SAU-001',
    category: 'Oils & Fats',
    supplier: 'Mediterranean Imports',
    venue: 'All Venues',
    onHand: 8000,
    min: 5000,
    max: 20000,
    unit: 'g',
    daysLeft: 8,
    avgUsage: 1000,
    cost: 0.015,
    status: 'Healthy',
    updated: '1 hour ago',
    batches: [
      { id: 'b-sau-1', batchNumber: 'SAU-B01', supplier: 'Mediterranean Imports', receivedDate: '2026-06-20', expiryDate: '2026-08-20', quantity: 8000 }
    ],
    batchNumber: 'SAU-B01',
    expiryDate: '2026-08-20'
  },
  {
    id: 'inv-12',
    name: 'Cheddar Cheese Slices',
    sku: 'CHS-001',
    category: 'Dairy',
    supplier: 'Dairy Fresh',
    venue: 'All Venues',
    onHand: 240,
    min: 150,
    max: 500,
    unit: 'slices',
    daysLeft: 4,
    avgUsage: 60,
    cost: 0.25,
    status: 'Healthy',
    updated: '2 hours ago',
    batches: [
      { id: 'b-chs-1', batchNumber: 'CHS-B01', supplier: 'Dairy Fresh', receivedDate: '2026-06-25', expiryDate: '2026-07-15', quantity: 240 }
    ],
    batchNumber: 'CHS-B01',
    expiryDate: '2026-07-15'
  },
  {
    id: 'inv-13',
    name: 'Garlic Butter Spread',
    sku: 'BUT-001',
    category: 'Dairy',
    supplier: 'Dairy Fresh',
    venue: 'Main Kitchen',
    onHand: 15,
    min: 10,
    max: 40,
    unit: 'kg',
    daysLeft: 7,
    avgUsage: 2,
    cost: 5.50,
    status: 'Healthy',
    updated: '3 hours ago',
    batches: [
      { id: 'b-but-1', batchNumber: 'BUT-B01', supplier: 'Dairy Fresh', receivedDate: '2026-06-28', expiryDate: '2026-07-28', quantity: 15 }
    ],
    batchNumber: 'BUT-B01',
    expiryDate: '2026-07-28'
  },
  {
    id: 'inv-14',
    name: 'Sourdough Loaf (Slices)',
    sku: 'SOU-001',
    category: 'Bakery',
    supplier: 'Bakery Co.',
    venue: 'All Venues',
    onHand: 35,
    min: 20,
    max: 80,
    unit: 'slices',
    daysLeft: 2,
    avgUsage: 15,
    cost: 0.30,
    status: 'Healthy',
    updated: '4 hours ago',
    batches: [
      { id: 'b-sou-1', batchNumber: 'SOU-B01', supplier: 'Bakery Co.', receivedDate: '2026-07-02', expiryDate: '2026-07-05', quantity: 35 }
    ],
    batchNumber: 'SOU-B01',
    expiryDate: '2026-07-05'
  }
];

// Let's generate another 50 random items for realistic virtualization & data grid testing
const categories = ['Raw Meat', 'Oils & Fats', 'Bakery', 'Dairy', 'Vegetables', 'Dry Goods', 'Beverages', 'Packaging'];
const suppliersList = ['Fresh Foods Ltd', 'Bakery Co.', 'Mediterranean Imports', 'Dairy Fresh', 'Green Valley'];
const units: Record<string, string> = {
  'Raw Meat': 'kg',
  'Oils & Fats': 'bottles',
  'Bakery': 'packs',
  'Dairy': 'kg',
  'Vegetables': 'kg',
  'Dry Goods': 'bags',
  'Beverages': 'cases',
  'Packaging': 'boxes'
};

for (let i = 15; i <= 60; i++) {
  const category = categories[i % categories.length];
  const supplier = suppliersList[i % suppliersList.length];
  const unit = units[category] || 'units';
  const sku = `${category.substring(0, 3).toUpperCase()}-${100 + i}`;
  const cost = Number((5.5 + (i * 0.75)).toFixed(2));
  const min = 10 + (i % 4) * 10;
  const max = min * 3;
  const onHand = i % 7 === 0 ? 0 : (i % 4 === 0 ? Math.floor(min * 0.5) : min + 15);
  const avgUsage = 2 + (i % 6);
  const daysLeft = onHand > 0 ? Math.ceil(onHand / avgUsage) : 0;
  
  let status: 'Zero Stock' | 'Low Stock' | 'Healthy' = 'Healthy';
  if (onHand === 0) status = 'Zero Stock';
  else if (onHand < min) status = 'Low Stock';

  const batchNum = `${category.substring(0, 3).toUpperCase()}-B${i}`;
  const expiry = new Date(Date.now() + (10 + (i % 15)) * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

  initialItems.push({
    id: `inv-${i}`,
    name: `${category} Ingredient #${i}`,
    sku,
    category,
    supplier,
    venue: i % 3 === 0 ? 'Main Kitchen' : (i % 3 === 1 ? 'Bar Lounge' : 'All Venues'),
    onHand,
    min,
    max,
    unit,
    daysLeft,
    avgUsage,
    cost,
    status,
    updated: `${i} mins ago`,
    batches: onHand > 0 ? [{
      id: `b-rand-${i}`,
      batchNumber: batchNum,
      supplier,
      receivedDate: '2026-06-28',
      expiryDate: expiry,
      quantity: onHand
    }] : [],
    batchNumber: onHand > 0 ? batchNum : undefined,
    expiryDate: onHand > 0 ? expiry : undefined
  });
}

// Purchase Orders (supporting Draft, Approved, Sent, Partially Received, Fully Received, Cancelled, Closed)
export const initialPurchaseOrders: PurchaseOrder[] = [
  {
    id: 'po-1',
    orderNumber: 'PO-2026-001',
    supplier: 'Fresh Foods Ltd',
    itemsCount: 2,
    totalAmount: 1190.00,
    status: 'Sent',
    orderDate: '2026-07-01',
    deliveryDate: '2026-07-04',
    items: [
      { productId: 'inv-1', name: 'Chicken Breast', expectedQty: 80, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 12.50 },
      { productId: 'inv-2', name: 'Lamb Shank', expectedQty: 10, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 18.90 }
    ],
    deliveryNotes: 'Please deliver to rear kitchen door.'
  },
  {
    id: 'po-2',
    orderNumber: 'PO-2026-002',
    supplier: 'Bakery Co.',
    itemsCount: 2,
    totalAmount: 226.00,
    status: 'Partially Received',
    orderDate: '2026-06-30',
    deliveryDate: '2026-07-02',
    items: [
      { productId: 'inv-4', name: 'Pita Bread', expectedQty: 50, receivedQty: 40, rejectedQty: 5, damagedQty: 5, unit: 'packs', cost: 2.80 },
      { productId: 'inv-10', name: 'Burger Bun', expectedQty: 200, receivedQty: 180, rejectedQty: 20, damagedQty: 0, unit: 'units', cost: 0.45 }
    ],
    supplierInvoice: 'INV-BAK-9901',
    deliveryNotes: 'Shortage on delivery due to oven failure.'
  },
  {
    id: 'po-3',
    orderNumber: 'PO-2026-003',
    supplier: 'Mediterranean Imports',
    itemsCount: 2,
    totalAmount: 513.00,
    status: 'Approved',
    orderDate: '2026-07-02',
    deliveryDate: '2026-07-05',
    items: [
      { productId: 'inv-3', name: 'Olive Oil Extra Virgin', expectedQty: 20, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'bottles', cost: 16.20 },
      { productId: 'inv-11', name: 'Special Burger Sauce', expectedQty: 12600, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'g', cost: 0.015 }
    ]
  },
  {
    id: 'po-4',
    orderNumber: 'PO-2026-004',
    supplier: 'Dairy Fresh',
    itemsCount: 2,
    totalAmount: 182.50,
    status: 'Draft',
    orderDate: '2026-07-02',
    deliveryDate: '2026-07-03',
    items: [
      { productId: 'inv-5', name: 'Greek Yogurt', expectedQty: 25, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 4.90 },
      { productId: 'inv-12', name: 'Cheddar Cheese Slices', expectedQty: 240, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'slices', cost: 0.25 }
    ]
  },
  {
    id: 'po-5',
    orderNumber: 'PO-2026-005',
    supplier: 'Green Valley',
    itemsCount: 2,
    totalAmount: 109.60,
    status: 'Fully Received',
    orderDate: '2026-06-28',
    deliveryDate: '2026-06-30',
    items: [
      { productId: 'inv-7', name: 'Tomatoes', expectedQty: 25, receivedQty: 25, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 3.20 },
      { productId: 'inv-8', name: 'Red Onion', expectedQty: 12, receivedQty: 12, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 2.40 }
    ],
    supplierInvoice: 'INV-GV-8821',
    deliveryNotes: 'All items received in good condition.'
  }
];

// Suppliers with enterprise metrics
export const initialSuppliers: Supplier[] = [
  {
    id: 'sup-1',
    name: 'Fresh Foods Ltd',
    onTimeRate: 98,
    leadTimeDays: 2,
    trend: 'up',
    contact: 'John Miller',
    phone: '+1 555-0192',
    email: 'john@freshfoods.com',
    category: 'Raw Meat',
    purchaseOrdersCount: 28,
    receivingHistoryCount: 26,
    averageDeliveryTime: 1.8,
    deliveryAccuracy: 97,
    lateDeliveries: 1,
    outstandingOrders: 1,
    preferred: true,
    priceTrends: [
      { month: 'April', changePercent: -1.2 },
      { month: 'May', changePercent: 0.5 },
      { month: 'June', changePercent: 1.8 }
    ]
  },
  {
    id: 'sup-2',
    name: 'Bakery Co.',
    onTimeRate: 91,
    leadTimeDays: 3,
    trend: 'up',
    contact: 'Sarah Baker',
    phone: '+1 555-0143',
    email: 'orders@bakeryco.com',
    category: 'Bakery',
    purchaseOrdersCount: 15,
    receivingHistoryCount: 14,
    averageDeliveryTime: 2.9,
    deliveryAccuracy: 92,
    lateDeliveries: 2,
    outstandingOrders: 1,
    preferred: false,
    priceTrends: [
      { month: 'April', changePercent: 0 },
      { month: 'May', changePercent: 2.4 },
      { month: 'June', changePercent: 0 }
    ]
  },
  {
    id: 'sup-3',
    name: 'Mediterranean Imports',
    onTimeRate: 89,
    leadTimeDays: 4,
    trend: 'down',
    contact: 'Marco Rossi',
    phone: '+1 555-0176',
    email: 'marco@medimports.com',
    category: 'Oils & Fats',
    purchaseOrdersCount: 12,
    receivingHistoryCount: 11,
    averageDeliveryTime: 4.2,
    deliveryAccuracy: 88,
    lateDeliveries: 3,
    outstandingOrders: 1,
    preferred: true,
    priceTrends: [
      { month: 'April', changePercent: 1.5 },
      { month: 'May', changePercent: 3.0 },
      { month: 'June', changePercent: 8.0 }
    ]
  },
  {
    id: 'sup-4',
    name: 'Dairy Fresh',
    onTimeRate: 97,
    leadTimeDays: 1,
    trend: 'up',
    contact: 'Emily Butter',
    phone: '+1 555-0129',
    email: 'emily@dairyfresh.com',
    category: 'Dairy',
    purchaseOrdersCount: 32,
    receivingHistoryCount: 32,
    averageDeliveryTime: 1.0,
    deliveryAccuracy: 99,
    lateDeliveries: 0,
    outstandingOrders: 1,
    preferred: true,
    priceTrends: [
      { month: 'April', changePercent: -0.5 },
      { month: 'May', changePercent: -0.2 },
      { month: 'June', changePercent: 0.4 }
    ]
  },
  {
    id: 'sup-5',
    name: 'Green Valley',
    onTimeRate: 94,
    leadTimeDays: 3,
    trend: 'stable',
    contact: 'David Green',
    phone: '+1 555-0165',
    email: 'david@greenvalley.com',
    category: 'Vegetables',
    purchaseOrdersCount: 22,
    receivingHistoryCount: 21,
    averageDeliveryTime: 2.8,
    deliveryAccuracy: 95,
    lateDeliveries: 1,
    outstandingOrders: 0,
    preferred: false,
    priceTrends: [
      { month: 'April', changePercent: -2.0 },
      { month: 'May', changePercent: -1.5 },
      { month: 'June', changePercent: 1.2 }
    ]
  }
];

// Stock Movements (Ledger System)
export const initialStockMovements: StockMovement[] = [
  { id: 'mov-1', date: '2026-07-02', time: '12:45', itemName: 'Chicken Breast', productId: 'inv-1', type: 'RECEIVE_PO', quantity: 20, unit: 'kg', value: 250.00, user: 'Cyrus M.', previousStock: 22, newStock: 42, reference: 'PO-2026-001', notes: 'Received final batch of PO.' },
  { id: 'mov-2', date: '2026-07-02', time: '11:30', itemName: 'Greek Yogurt', productId: 'inv-5', type: 'RECEIVE_ADHOC', quantity: 10, unit: 'kg', value: 49.00, user: 'Cyrus M.', previousStock: 15, newStock: 25, reference: 'REC-9910', notes: 'Quick receive from supermarket.' },
  { id: 'mov-3', date: '2026-07-02', time: '10:15', itemName: 'Chicken Breast', productId: 'inv-1', type: 'SCRAP', quantity: -2, unit: 'kg', value: -25.00, user: 'Chef Arthur', previousStock: 44, newStock: 42, reason: 'Prep Waste', notes: 'Excess fat trimmed.' },
  { id: 'mov-4', date: '2026-07-02', time: '13:00', itemName: 'Beef Patty (150g)', productId: 'inv-9', type: 'RECIPE_CONSUMPTION', quantity: -30, unit: 'units', value: -54.00, user: 'KDS Sync', previousStock: 180, newStock: 150, reference: 'ORD-1002', notes: 'Orders completed at POS.' },
  { id: 'mov-5', date: '2026-07-02', time: '12:00', itemName: 'Burger Bun', productId: 'inv-10', type: 'RECIPE_CONSUMPTION', quantity: -30, unit: 'units', value: -13.50, user: 'KDS Sync', previousStock: 150, newStock: 120, reference: 'ORD-1002', notes: 'Orders completed at POS.' },
  { id: 'mov-6', date: '2026-07-02', time: '11:00', itemName: 'Pita Bread', productId: 'inv-4', type: 'EXPIRED', quantity: -8, unit: 'packs', value: -22.40, user: 'Manager', previousStock: 8, newStock: 0, reason: 'Expired stock', notes: 'Batch expired on shelf.' },
  { id: 'mov-7', date: '2026-07-02', time: '10:00', itemName: 'Tomatoes', productId: 'inv-7', type: 'SCRAP', quantity: -3, unit: 'kg', value: -9.60, user: 'Chef Arthur', previousStock: 11, newStock: 8, reason: 'Spoiled', notes: 'Soft/bruised tomatoes discarded.' },
  { id: 'mov-8', date: '2026-07-02', time: '09:00', itemName: 'Feta Cheese', productId: 'inv-6', type: 'SCRAP', quantity: -1, unit: 'kg', value: -9.80, user: 'Chef Arthur', previousStock: 13, newStock: 12, reason: 'Damaged', notes: 'Dropped package.' },
  { id: 'mov-9', date: '2026-07-02', time: '08:30', itemName: 'Lamb Shank', productId: 'inv-2', type: 'TRANSFER_OUT', quantity: -2, unit: 'kg', value: -37.80, user: 'Cyrus M.', previousStock: 20, newStock: 18, reference: 'TRSF-001', notes: 'Transferred to Bar Lounge.' },
  { id: 'mov-10', date: '2026-07-02', time: '08:00', itemName: 'Tomatoes', productId: 'inv-7', type: 'STOCK_ADJUSTMENT', quantity: -1, unit: 'kg', value: -3.20, user: 'Cyrus M.', previousStock: 12, newStock: 11, reason: 'Lost Stock', notes: 'Physical adjustment.' }
];

// Recipes (supporting Bill of Materials)
export const initialRecipes: Recipe[] = [
  {
    id: 'rec-1',
    name: 'Grilled Beef Burger',
    category: 'Burgers',
    ingredientsCount: 4,
    costPerPortion: 2.80,
    margin: 80.0,
    sellingPrice: 14.00,
    ingredients: [
      { productId: 'inv-9', name: 'Beef Patty (150g)', quantity: 1, unit: 'units' },
      { productId: 'inv-10', name: 'Burger Bun', quantity: 1, unit: 'units' },
      { productId: 'inv-11', name: 'Special Burger Sauce', quantity: 20, unit: 'g' },
      { productId: 'inv-12', name: 'Cheddar Cheese Slices', quantity: 1, unit: 'slices' }
    ]
  },
  {
    id: 'rec-2',
    name: 'Greek Salad',
    category: 'Salads',
    ingredientsCount: 4,
    costPerPortion: 2.10,
    margin: 82.5,
    sellingPrice: 12.00,
    ingredients: [
      { productId: 'inv-6', name: 'Feta Cheese', quantity: 0.1, unit: 'kg' },
      { productId: 'inv-7', name: 'Tomatoes', quantity: 0.25, unit: 'kg' },
      { productId: 'inv-8', name: 'Red Onion', quantity: 0.05, unit: 'kg' },
      { productId: 'inv-3', name: 'Olive Oil Extra Virgin', quantity: 0.02, unit: 'bottles' }
    ]
  },
  {
    id: 'rec-3',
    name: 'Slow Cooked Lamb Shank',
    category: 'Mains',
    ingredientsCount: 3,
    costPerPortion: 11.20,
    margin: 68.0,
    sellingPrice: 35.00,
    ingredients: [
      { productId: 'inv-2', name: 'Lamb Shank', quantity: 0.5, unit: 'kg' },
      { productId: 'inv-7', name: 'Tomatoes', quantity: 0.15, unit: 'kg' },
      { productId: 'inv-8', name: 'Red Onion', quantity: 0.05, unit: 'kg' }
    ]
  },
  {
    id: 'rec-4',
    name: 'Garlic Bread Slices',
    category: 'Sides',
    ingredientsCount: 2,
    costPerPortion: 0.85,
    margin: 85.8,
    sellingPrice: 6.00,
    ingredients: [
      { productId: 'inv-14', name: 'Sourdough Loaf (Slices)', quantity: 2, unit: 'slices' },
      { productId: 'inv-13', name: 'Garlic Butter Spread', quantity: 0.05, unit: 'kg' }
    ]
  }
];

// Stocktakes (Enterprise historical audits)
export const initialStocktakes: StocktakeRecord[] = [
  { id: 'stk-1', date: '2026-07-01', itemsAudited: 14, discrepancyCount: 3, accuracyPercent: 97.9, status: 'Completed', varianceCost: -53.50, area: 'Main Fridge' },
  { id: 'stk-2', date: '2026-06-15', itemsAudited: 12, discrepancyCount: 1, accuracyPercent: 99.1, status: 'Completed', varianceCost: -12.50, area: 'Dry Pantry' },
  { id: 'stk-3', date: '2026-06-01', itemsAudited: 10, discrepancyCount: 0, accuracyPercent: 100.0, status: 'Completed', varianceCost: 0.00, area: 'All areas' }
];

// Venue Transfers
export const initialTransfers: InventoryTransfer[] = [
  {
    id: 'trsf-1',
    transferNumber: 'TRSF-001',
    fromVenue: 'Main Kitchen',
    toVenue: 'Bar Lounge',
    items: [
      { productId: 'inv-2', name: 'Lamb Shank', quantity: 2, unit: 'kg', cost: 18.90 },
      { productId: 'inv-5', name: 'Greek Yogurt', quantity: 5, unit: 'kg', cost: 4.90 }
    ],
    status: 'Received',
    date: '2026-07-02',
    notes: 'Urgent transfer for evening specials.'
  },
  {
    id: 'trsf-2',
    transferNumber: 'TRSF-002',
    fromVenue: 'Main Kitchen',
    toVenue: 'Bar Lounge',
    items: [
      { productId: 'inv-10', name: 'Burger Bun', quantity: 50, unit: 'units', cost: 0.45 }
    ],
    status: 'Pending',
    date: '2026-07-02',
    notes: 'Refilling the bar snack buns.'
  }
];
