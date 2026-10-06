export interface InventoryBatch {
  id: string;
  batchNumber: string;
  supplier: string;
  receivedDate: string;
  expiryDate: string;
  quantity: number;
  status?: 'Expired' | 'Expiring Today' | 'Expiring Soon' | 'Healthy';
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  supplier: string;
  venue: string;
  onHand: number;
  min: number;
  max: number;
  unit: string;
  daysLeft: number; // calculated or mocked
  avgUsage: number; // average usage per day
  cost: number;
  status: 'Zero Stock' | 'Low Stock' | 'Healthy' | 'Critical' | 'Out of Stock' | 'Expired';
  updated: string;
  image?: string;
  expiryDate?: string;
  batchNumber?: string;
  expiredQty?: number;
  batches?: InventoryBatch[];
  
  // Theoretical vs Actual
  expectedStock?: number;
  actualStock?: number;
  wasteStock?: number;
  varianceQty?: number;
  varianceCost?: number;
}

export interface PurchaseOrderItem {
  productId: string;
  name: string;
  expectedQty: number;
  receivedQty: number;
  rejectedQty: number;
  damagedQty: number;
  unit: string;
  cost: number;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplier: string;
  itemsCount: number;
  totalAmount: number;
  status: 'Draft' | 'Approved' | 'Sent' | 'Partially Received' | 'Fully Received' | 'Cancelled' | 'Closed';
  orderDate: string;
  deliveryDate: string;
  items: PurchaseOrderItem[];
  supplierInvoice?: string;
  deliveryNotes?: string;
}

export interface SupplierPriceTrend {
  month: string;
  changePercent: number;
}

export interface Supplier {
  id: string;
  name: string;
  onTimeRate: number; // e.g., 98 for 98%
  leadTimeDays: number;
  trend: 'up' | 'down' | 'stable';
  contact: string;
  phone: string;
  email: string;
  category: string;
  
  // Enterprise fields
  purchaseOrdersCount?: number;
  receivingHistoryCount?: number;
  averageDeliveryTime?: number; // hours/days
  priceTrends?: SupplierPriceTrend[];
  deliveryAccuracy?: number; // e.g. 96 for 96%
  lateDeliveries?: number;
  outstandingOrders?: number;
  preferred?: boolean;
}

export interface StockMovement {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  itemName: string;
  productId?: string;
  type: 
    | 'RECEIVE_PO'
    | 'RECEIVE_ADHOC'
    | 'TRANSFER_IN'
    | 'TRANSFER_OUT'
    | 'SALE_CONSUMPTION'
    | 'RECIPE_CONSUMPTION'
    | 'STOCK_ADJUSTMENT'
    | 'SCRAP'
    | 'EXPIRED'
    | 'RETURN'
    | 'STOCKTAKE'
    | 'PURCHASE_RETURN'
    | 'SUPPLIER_CREDIT';
  quantity: number;
  unit: string;
  value: number;
  user: string;
  previousStock?: number;
  newStock?: number;
  reason?: string;
  reference?: string;
  notes?: string;
  batchNumber?: string;
  venue?: string;
}

export interface RecipeIngredient {
  productId: string;
  name: string;
  quantity: number; // amount of ingredient (e.g., 0.15 for 150g)
  unit: string;
}

export interface Recipe {
  id: string;
  name: string;
  category: string;
  ingredientsCount: number;
  costPerPortion: number;
  margin: number;
  sellingPrice: number;
  ingredients: RecipeIngredient[];
}

export interface StocktakeRecord {
  id: string;
  date: string;
  itemsAudited: number;
  discrepancyCount: number;
  accuracyPercent: number;
  status: 'Completed' | 'In Progress';
  varianceCost?: number;
  area?: string;
  category?: string;
}

export interface InventoryTransferItem {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  cost: number;
}

export interface InventoryTransfer {
  id: string;
  transferNumber: string;
  fromVenue: string;
  toVenue: string;
  items: InventoryTransferItem[];
  status: 'Pending' | 'Received' | 'Rejected';
  date: string;
  notes?: string;
}
