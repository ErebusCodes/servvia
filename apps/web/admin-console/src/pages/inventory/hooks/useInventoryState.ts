import { useState } from 'react';
import { 
  InventoryItem, 
  PurchaseOrder, 
  Supplier, 
  StockMovement, 
  Recipe, 
  StocktakeRecord, 
  InventoryTransfer, 
  InventoryBatch,
  PurchaseOrderItem,
  InventoryTransferItem
} from '../types';
import { 
  initialItems, 
  initialPurchaseOrders, 
  initialSuppliers, 
  initialStockMovements, 
  initialRecipes, 
  initialStocktakes, 
  initialTransfers 
} from '../mockData';

export function useInventoryState() {
  // ── Core States ───────────────────────────────────────────────────────────
  const [items, setItems] = useState<InventoryItem[]>(initialItems);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(initialPurchaseOrders);
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>(initialStockMovements);
  const [recipes] = useState<Recipe[]>(initialRecipes);
  const [stocktakes, setStocktakes] = useState<StocktakeRecord[]>(initialStocktakes);
  const [transfers, setTransfers] = useState<InventoryTransfer[]>(initialTransfers);

  // Layout & Navigation Tab
  const [tab, setTab] = useState<
    'inventory' | 'orders' | 'receiving' | 'movements' | 'waste' | 'stocktake' | 'recipes' | 'suppliers' | 'transfers' | 'reports' | 'alerts'
  >('inventory');

  // Search & Filtering States
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [venueFilter, setVenueFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stockLevelFilter, setStockLevelFilter] = useState('all');
  const [expiryFilter, setExpiryFilter] = useState<'all' | 'expired' | 'expires_today' | 'expires_soon'>('all');
  const [batchFilter, setBatchFilter] = useState<'all' | 'has_batch' | 'no_batch'>('all');
  const [expiryStartFilter, setExpiryStartFilter] = useState('');
  const [expiryEndFilter, setExpiryEndFilter] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState('all');
  const [movementStartFilter, setMovementStartFilter] = useState('');
  const [movementEndFilter, setMovementEndFilter] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');

  // Sorting and Pagination
  const [sortField, setSortField] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Activity Feed
  const [activityFeed, setActivityFeed] = useState([
    { id: 'act-1', text: 'Received PO-2026-002 shipments', time: '10 min ago' },
    { id: 'act-2', text: 'Adjusted Chicken Breast -1kg (Trim waste)', time: '1 hr ago' },
    { id: 'act-3', text: 'POS synced: consumed ingredients for 30 Burgers', time: '2 hrs ago' },
    { id: 'act-4', text: 'Marked 8 packs Pita Bread as Expired', time: '4 hrs ago' },
    { id: 'act-5', text: 'Completed stocktake in Main Fridge', time: '1 day ago' }
  ]);

  const addActivity = (text: string) => {
    setActivityFeed(prev => [
      { id: `act-${Date.now()}-${Math.random()}`, text, time: 'Just now' },
      ...prev.slice(0, 19)
    ]);
  };

  // ── Helper: Batch Consumption (FIFO) ──────────────────────────────────────
  const consumeFromItemBatches = (batches: InventoryBatch[] | undefined, quantityToConsume: number) => {
    if (!batches || batches.length === 0) return { updatedBatches: [], consumedBatches: [] };
    const sortedBatches = [...batches].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
    let remaining = quantityToConsume;
    const updatedBatches: InventoryBatch[] = [];
    const consumedBatches: { batchNumber: string; quantity: number }[] = [];

    for (const batch of sortedBatches) {
      if (remaining <= 0) {
        updatedBatches.push(batch);
        continue;
      }
      if (batch.quantity <= remaining) {
        remaining -= batch.quantity;
        consumedBatches.push({ batchNumber: batch.batchNumber, quantity: batch.quantity });
      } else {
        updatedBatches.push({
          ...batch,
          quantity: batch.quantity - remaining
        });
        consumedBatches.push({ batchNumber: batch.batchNumber, quantity: remaining });
        remaining = 0;
      }
    }
    return { updatedBatches, consumedBatches };
  };

  // ── Core Mutator Methods (Audited Movements) ──────────────────────────────

  // 1. Create Purchase Order
  const createPurchaseOrder = (supplierName: string, itemsList: { productId: string; quantity: number; cost: number }[], notes?: string) => {
    const poItems: PurchaseOrderItem[] = itemsList.map(it => {
      const match = items.find(i => i.id === it.productId);
      return {
        productId: it.productId,
        name: match ? match.name : 'Unknown Item',
        expectedQty: it.quantity,
        receivedQty: 0,
        rejectedQty: 0,
        damagedQty: 0,
        unit: match ? match.unit : 'units',
        cost: it.cost
      };
    });

    const total = poItems.reduce((sum, item) => sum + (item.expectedQty * item.cost), 0);
    const orderNum = `PO-2026-${String(purchaseOrders.length + 1).padStart(3, '0')}`;

    const newPO: PurchaseOrder = {
      id: `po-${Date.now()}`,
      orderNumber: orderNum,
      supplier: supplierName,
      itemsCount: poItems.length,
      totalAmount: total,
      status: 'Sent',
      orderDate: new Date().toISOString().substring(0, 10),
      deliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
      items: poItems,
      deliveryNotes: notes
    };

    setPurchaseOrders(prev => [newPO, ...prev]);
    showToast(`Created Purchase Order ${orderNum}`, 'success');
    addActivity(`Created Purchase Order ${orderNum} for ${supplierName}`);
  };

  // 2. Receive Stock against PO (Partial/Full)
  const receivePOStock = (
    poId: string, 
    lines: { productId: string; receivedQty: number; rejectedQty: number; damagedQty: number; cost: number; expiryDate?: string; batchNumber?: string }[], 
    invoiceNumber: string, 
    deliveryNotes: string
  ) => {
    const poIndex = purchaseOrders.findIndex(p => p.id === poId);
    if (poIndex === -1) return;
    const po = purchaseOrders[poIndex];

    const updatedPOItems = po.items.map(item => {
      const matchLine = lines.find(l => l.productId === item.productId);
      if (matchLine) {
        return {
          ...item,
          receivedQty: item.receivedQty + matchLine.receivedQty,
          rejectedQty: item.rejectedQty + matchLine.rejectedQty,
          damagedQty: item.damagedQty + matchLine.damagedQty,
          cost: matchLine.cost
        };
      }
      return item;
    });

    // Check if fully received
    const allReceived = updatedPOItems.every(item => item.receivedQty >= item.expectedQty);
    const anyReceived = updatedPOItems.some(item => item.receivedQty > 0);
    const status = allReceived ? 'Fully Received' : (anyReceived ? 'Partially Received' : 'Sent');

    const updatedPO: PurchaseOrder = {
      ...po,
      items: updatedPOItems,
      status,
      supplierInvoice: invoiceNumber,
      deliveryNotes
    };

    setPurchaseOrders(prev => prev.map(p => p.id === poId ? updatedPO : p));

    // Ledger movements and Item stock adjustments
    const updatedItems = [...items];
    const newMovements: StockMovement[] = [];
    const todayStr = new Date().toISOString().substring(0, 10);
    const timeStr = new Date().toTimeString().substring(0, 5);

    lines.forEach(line => {
      if (line.receivedQty <= 0) return;
      const itemIndex = updatedItems.findIndex(i => i.id === line.productId);
      if (itemIndex === -1) return;
      const targetItem = updatedItems[itemIndex];
      const prevStock = targetItem.onHand;
      const newQty = prevStock + line.receivedQty;

      // Add Batch
      const receivedBatchNo = line.batchNumber || `BAT-${Date.now().toString().slice(-4)}`;
      const updatedBatches = [...(targetItem.batches || [])];
      updatedBatches.push({
        id: `b-rec-${Date.now()}-${Math.random()}`,
        batchNumber: receivedBatchNo,
        supplier: po.supplier,
        receivedDate: todayStr,
        expiryDate: line.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
        quantity: line.receivedQty,
        status: 'Healthy'
      });

      // Recalculate status and active expiry
      let nearestBatchNum = receivedBatchNo;
      let nearestExpiry = line.expiryDate;
      const activeBatches = updatedBatches.filter(b => b.quantity > 0);
      let newStatus: InventoryItem['status'] = 'Healthy';

      if (activeBatches.length > 0) {
        activeBatches.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
        nearestBatchNum = activeBatches[0].batchNumber;
        nearestExpiry = activeBatches[0].expiryDate;
        
        const diffDays = Math.ceil((new Date(nearestExpiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) newStatus = 'Expired';
        else if (newQty < targetItem.min) newStatus = 'Low Stock';
      }

      updatedItems[itemIndex] = {
        ...targetItem,
        onHand: newQty,
        batches: updatedBatches,
        batchNumber: nearestBatchNum,
        expiryDate: nearestExpiry,
        status: newQty === 0 ? 'Zero Stock' : newStatus,
        daysLeft: targetItem.avgUsage > 0 ? Math.ceil(newQty / targetItem.avgUsage) : 99,
        updated: 'Received PO just now'
      };

      // Ledger entry
      newMovements.push({
        id: `mov-${Date.now()}-${Math.random()}`,
        date: todayStr,
        time: timeStr,
        itemName: targetItem.name,
        productId: targetItem.id,
        type: 'RECEIVE_PO',
        quantity: line.receivedQty,
        unit: targetItem.unit,
        value: line.receivedQty * line.cost,
        user: 'Manager',
        previousStock: prevStock,
        newStock: newQty,
        reference: po.orderNumber,
        notes: `Invoice: ${invoiceNumber}. Rejected: ${line.rejectedQty}, Damaged: ${line.damagedQty}`,
        batchNumber: receivedBatchNo,
        venue: 'All Venues'
      });
    });

    setItems(updatedItems);
    setStockMovements(prev => [...newMovements, ...prev]);
    showToast(`Received stock for order ${po.orderNumber}`, 'success');
    addActivity(`Received delivery for ${po.orderNumber} (Invoice: ${invoiceNumber})`);
  };

  // 3. Quick Receive (Supermarket / Adhoc Purchases)
  const quickReceiveStock = (
    supplierName: string, 
    receiptNumber: string, 
    invoicePlaceholder: string, 
    lines: { productId: string; quantity: number; cost: number; expiryDate: string; batchNumber: string }[], 
    notes: string
  ) => {
    const updatedItems = [...items];
    const newMovements: StockMovement[] = [];
    const todayStr = new Date().toISOString().substring(0, 10);
    const timeStr = new Date().toTimeString().substring(0, 5);

    lines.forEach(line => {
      const itemIndex = updatedItems.findIndex(i => i.id === line.productId);
      if (itemIndex === -1) return;
      const targetItem = updatedItems[itemIndex];
      const prevStock = targetItem.onHand;
      const newQty = prevStock + line.quantity;

      const receivedBatchNo = line.batchNumber || `BAT-ADHOC-${Date.now().toString().slice(-4)}`;
      const updatedBatches = [...(targetItem.batches || [])];
      updatedBatches.push({
        id: `b-adh-${Date.now()}-${Math.random()}`,
        batchNumber: receivedBatchNo,
        supplier: supplierName || 'Local Supplier',
        receivedDate: todayStr,
        expiryDate: line.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
        quantity: line.quantity,
        status: 'Healthy'
      });

      let nearestBatchNum = receivedBatchNo;
      let nearestExpiry = line.expiryDate;
      const activeBatches = updatedBatches.filter(b => b.quantity > 0);
      let newStatus: InventoryItem['status'] = 'Healthy';

      if (activeBatches.length > 0) {
        activeBatches.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
        nearestBatchNum = activeBatches[0].batchNumber;
        nearestExpiry = activeBatches[0].expiryDate;
      }

      if (newQty < targetItem.min) newStatus = 'Low Stock';
      if (newQty === 0) newStatus = 'Zero Stock';

      updatedItems[itemIndex] = {
        ...targetItem,
        onHand: newQty,
        batches: updatedBatches,
        batchNumber: nearestBatchNum,
        expiryDate: nearestExpiry,
        status: newStatus,
        daysLeft: targetItem.avgUsage > 0 ? Math.ceil(newQty / targetItem.avgUsage) : 99,
        updated: 'Ad-hoc received just now'
      };

      newMovements.push({
        id: `mov-${Date.now()}-${Math.random()}`,
        date: todayStr,
        time: timeStr,
        itemName: targetItem.name,
        productId: targetItem.id,
        type: 'RECEIVE_ADHOC',
        quantity: line.quantity,
        unit: targetItem.unit,
        value: line.quantity * line.cost,
        user: 'Manager',
        previousStock: prevStock,
        newStock: newQty,
        reference: receiptNumber || invoicePlaceholder || 'ADHOC-REC',
        notes: `Quick purchase. ${notes}`,
        batchNumber: receivedBatchNo,
        venue: 'All Venues'
      });
    });

    setItems(updatedItems);
    setStockMovements(prev => [...newMovements, ...prev]);
    showToast(`Quick-received ${lines.length} items.`, 'success');
    addActivity(`Quick received ${lines.length} items from ${supplierName || 'local vendor'}`);
  };

  // 4. Stock Adjustments (Audited corrections)
  const adjustStock = (
    itemId: string, 
    qtyDelta: number, 
    reason: 'Physical Count' | 'Found Stock' | 'Lost Stock' | 'Supplier Error' | 'Manual Correction' | 'Damage' | 'Theft' | 'Unknown' | 'Other', 
    notes: string
  ) => {
    const itemIndex = items.findIndex(i => i.id === itemId);
    if (itemIndex === -1) return;
    const targetItem = items[itemIndex];
    const prevStock = targetItem.onHand;
    const newQty = prevStock + qtyDelta;

    if (newQty < 0) {
      showToast('Adjustment cannot cause stock to fall below zero.', 'error');
      return;
    }

    const updatedBatches = [...(targetItem.batches || [])];
    if (qtyDelta < 0) {
      const { updatedBatches: afterConsume } = consumeFromItemBatches(updatedBatches, Math.abs(qtyDelta));
      targetItem.batches = afterConsume;
    } else if (qtyDelta > 0) {
      if (updatedBatches.length > 0) {
        updatedBatches[updatedBatches.length - 1].quantity += qtyDelta;
      } else {
        updatedBatches.push({
          id: `b-adj-${Date.now()}`,
          batchNumber: `ADJ-${Date.now().toString().slice(-4)}`,
          supplier: targetItem.supplier,
          receivedDate: new Date().toISOString().substring(0, 10),
          expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
          quantity: qtyDelta,
          status: 'Healthy'
        });
      }
    }

    let newStatus: InventoryItem['status'] = 'Healthy';
    if (newQty === 0) newStatus = 'Zero Stock';
    else if (newQty < targetItem.min) newStatus = 'Low Stock';

    const updatedItem: InventoryItem = {
      ...targetItem,
      onHand: newQty,
      batches: updatedBatches,
      status: newStatus,
      daysLeft: targetItem.avgUsage > 0 ? Math.ceil(newQty / targetItem.avgUsage) : 99,
      updated: 'Adjusted just now'
    };

    setItems(prev => prev.map(i => i.id === itemId ? updatedItem : i));

    const todayStr = new Date().toISOString().substring(0, 10);
    const timeStr = new Date().toTimeString().substring(0, 5);

    setStockMovements(prev => [{
      id: `mov-${Date.now()}`,
      date: todayStr,
      time: timeStr,
      itemName: targetItem.name,
      productId: targetItem.id,
      type: 'STOCK_ADJUSTMENT',
      quantity: qtyDelta,
      unit: targetItem.unit,
      value: qtyDelta * targetItem.cost,
      user: 'Manager',
      previousStock: prevStock,
      newStock: newQty,
      reason,
      notes
    }, ...prev]);

    showToast(`Adjusted ${targetItem.name} count by ${qtyDelta >= 0 ? '+' : ''}${qtyDelta}`, 'success');
    addActivity(`Adjusted ${targetItem.name} ${qtyDelta >= 0 ? '+' : ''}${qtyDelta} (${reason})`);
  };

  // 5. Scrap / Waste Management
  const recordWaste = (
    itemId: string, 
    quantity: number, 
    reason: 'Prep Waste' | 'Cooking Waste' | 'Expired' | 'Spoiled' | 'Damaged' | 'Kitchen Error' | 'Customer Return' | 'Overproduction' | 'Accidental Waste' | 'Staff Meal', 
    employee: string, 
    shift: string, 
    notes: string
  ) => {
    const itemIndex = items.findIndex(i => i.id === itemId);
    if (itemIndex === -1) return;
    const targetItem = items[itemIndex];
    const prevStock = targetItem.onHand;

    if (prevStock < quantity) {
      showToast('Waste quantity exceeds current stock level.', 'error');
      return;
    }

    const newQty = prevStock - quantity;
    const updatedBatches = [...(targetItem.batches || [])];
    const { updatedBatches: afterConsume } = consumeFromItemBatches(updatedBatches, quantity);

    let newStatus: InventoryItem['status'] = 'Healthy';
    if (newQty === 0) newStatus = 'Zero Stock';
    else if (newQty < targetItem.min) newStatus = 'Low Stock';

    const updatedItem: InventoryItem = {
      ...targetItem,
      onHand: newQty,
      batches: afterConsume,
      status: newStatus,
      daysLeft: targetItem.avgUsage > 0 ? Math.ceil(newQty / targetItem.avgUsage) : 99,
      updated: 'Recorded waste just now'
    };

    setItems(prev => prev.map(i => i.id === itemId ? updatedItem : i));

    const todayStr = new Date().toISOString().substring(0, 10);
    const timeStr = new Date().toTimeString().substring(0, 5);

    setStockMovements(prev => [{
      id: `mov-${Date.now()}`,
      date: todayStr,
      time: timeStr,
      itemName: targetItem.name,
      productId: targetItem.id,
      type: 'SCRAP',
      quantity: -quantity,
      unit: targetItem.unit,
      value: -quantity * targetItem.cost,
      user: employee || 'Chef Arthur',
      previousStock: prevStock,
      newStock: newQty,
      reason,
      notes: `Shift: ${shift}. ${notes}`
    }, ...prev]);

    showToast(`Logged ${quantity} ${targetItem.unit} waste for ${targetItem.name}`, 'success');
    addActivity(`Wasted ${quantity} ${targetItem.unit} of ${targetItem.name} (${reason} - ${employee})`);
  };

  // 6. Expired Stock Actions
  const handleExpiredStock = (
    itemId: string, 
    batchId: string, 
    quantity: number, 
    actionType: 'Dispose' | 'Return to Supplier' | 'Discount' | 'Donate', 
    notes: string
  ) => {
    const itemIndex = items.findIndex(i => i.id === itemId);
    if (itemIndex === -1) return;
    const targetItem = items[itemIndex];
    const prevStock = targetItem.onHand;
    const qtyDeducted = Math.min(quantity, prevStock);

    const updatedBatches = [...(targetItem.batches || [])];
    let targetBatchNum = 'N/A';
    const batchIndex = updatedBatches.findIndex(b => b.id === batchId);
    
    if (batchIndex !== -1) {
      const b = updatedBatches[batchIndex];
      targetBatchNum = b.batchNumber;
      updatedBatches[batchIndex] = {
        ...b,
        quantity: Math.max(0, b.quantity - qtyDeducted)
      };
    } else {
      const { updatedBatches: afterConsume, consumedBatches } = consumeFromItemBatches(updatedBatches, qtyDeducted);
      if (consumedBatches.length > 0) targetBatchNum = consumedBatches[0].batchNumber;
      targetItem.batches = afterConsume;
    }

    const newQty = prevStock - qtyDeducted;
    let newStatus: InventoryItem['status'] = 'Healthy';
    if (newQty === 0) newStatus = 'Zero Stock';
    else if (newQty < targetItem.min) newStatus = 'Low Stock';

    const updatedItem: InventoryItem = {
      ...targetItem,
      onHand: newQty,
      batches: updatedBatches,
      status: newStatus,
      expiredQty: (targetItem.expiredQty || 0) + qtyDeducted,
      daysLeft: targetItem.avgUsage > 0 ? Math.ceil(newQty / targetItem.avgUsage) : 99,
      updated: 'Processed expired stock'
    };

    setItems(prev => prev.map(i => i.id === itemId ? updatedItem : i));

    const todayStr = new Date().toISOString().substring(0, 10);
    const timeStr = new Date().toTimeString().substring(0, 5);
    const movType = actionType === 'Return to Supplier' ? 'RETURN' : 'EXPIRED';

    setStockMovements(prev => [{
      id: `mov-${Date.now()}`,
      date: todayStr,
      time: timeStr,
      itemName: targetItem.name,
      productId: targetItem.id,
      type: movType,
      quantity: -qtyDeducted,
      unit: targetItem.unit,
      value: -qtyDeducted * targetItem.cost,
      user: 'Manager',
      previousStock: prevStock,
      newStock: newQty,
      reason: `Expiry Action: ${actionType}`,
      notes: `Batch: ${targetBatchNum}. ${notes}`
    }, ...prev]);

    showToast(`Processed expiry: ${actionType} for ${qtyDeducted} ${targetItem.unit}`, 'success');
    addActivity(`Expired batch action: ${actionType} for ${targetItem.name} (Batch: ${targetBatchNum})`);
  };

  // 7. Multi-Venue Transfers
  const createStockTransfer = (fromVenue: string, toVenue: string, itemsList: { productId: string; quantity: number }[], notes?: string) => {
    const transferItems: InventoryTransferItem[] = itemsList.map(it => {
      const match = items.find(i => i.id === it.productId);
      return {
        productId: it.productId,
        name: match ? match.name : 'Unknown Item',
        quantity: it.quantity,
        unit: match ? match.unit : 'units',
        cost: match ? match.cost : 0
      };
    });

    const newTransfer: InventoryTransfer = {
      id: `trsf-${Date.now()}`,
      transferNumber: `TRSF-${String(transfers.length + 1).padStart(3, '0')}`,
      fromVenue,
      toVenue,
      items: transferItems,
      status: 'Pending',
      date: new Date().toISOString().substring(0, 10),
      notes
    };

    setTransfers(prev => [newTransfer, ...prev]);
    showToast(`Created Transfer request ${newTransfer.transferNumber}`, 'success');
    addActivity(`Transfer pending: ${newTransfer.transferNumber} from ${fromVenue} to ${toVenue}`);
  };

  const receiveStockTransfer = (transferId: string) => {
    const trsfIndex = transfers.findIndex(t => t.id === transferId);
    if (trsfIndex === -1) return;
    const trsf = transfers[trsfIndex];

    const updatedTransfers = transfers.map(t => t.id === transferId ? { ...t, status: 'Received' as const } : t);
    setTransfers(updatedTransfers);

    const updatedItems = [...items];
    const newMovements: StockMovement[] = [];
    const todayStr = new Date().toISOString().substring(0, 10);
    const timeStr = new Date().toTimeString().substring(0, 5);

    trsf.items.forEach(line => {
      // Find item
      const itemIndex = updatedItems.findIndex(i => i.id === line.productId);
      if (itemIndex === -1) return;
      const targetItem = updatedItems[itemIndex];
      
      // Note: In local mock state, we assume "All Venues" reflects the total,
      // so a transfer changes venue assignment or creates ledger receipts for internal audit.
      // If we transfer between specific venue stock, we update details.
      const prevStock = targetItem.onHand;
      const val = line.quantity * targetItem.cost;

      // Transfer Out Movement
      newMovements.push({
        id: `mov-${Date.now()}-out-${Math.random()}`,
        date: todayStr,
        time: timeStr,
        itemName: targetItem.name,
        productId: targetItem.id,
        type: 'TRANSFER_OUT',
        quantity: -line.quantity,
        unit: targetItem.unit,
        value: -val,
        user: 'Staff Sync',
        previousStock: prevStock,
        newStock: prevStock - line.quantity,
        reference: trsf.transferNumber,
        notes: `Transfer out from ${trsf.fromVenue} to ${trsf.toVenue}`
      });

      // Transfer In Movement
      newMovements.push({
        id: `mov-${Date.now()}-in-${Math.random()}`,
        date: todayStr,
        time: timeStr,
        itemName: targetItem.name,
        productId: targetItem.id,
        type: 'TRANSFER_IN',
        quantity: line.quantity,
        unit: targetItem.unit,
        value: val,
        user: 'Staff Sync',
        previousStock: prevStock - line.quantity,
        newStock: prevStock,
        reference: trsf.transferNumber,
        notes: `Received at ${trsf.toVenue} from ${trsf.fromVenue}`
      });
    });

    setStockMovements(prev => [...newMovements, ...prev]);
    showToast(`Received Transfer ${trsf.transferNumber}`, 'success');
    addActivity(`Completed Transfer ${trsf.transferNumber} to ${trsf.toVenue}`);
  };

  const rejectStockTransfer = (transferId: string) => {
    setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, status: 'Rejected' as const } : t));
    showToast(`Rejected stock transfer`, 'info');
  };

  // 8. Recipe Sales Simulation (BOM Auto-Consumption)
  const simulateRecipeSales = (sales: { recipeId: string; quantityCount: number }[]) => {
    const updatedItems = [...items];
    const newMovements: StockMovement[] = [];
    const todayStr = new Date().toISOString().substring(0, 10);
    const timeStr = new Date().toTimeString().substring(0, 5);
    let successCount = 0;

    sales.forEach(sale => {
      const recipe = recipes.find(r => r.id === sale.recipeId);
      if (!recipe) return;

      successCount += sale.quantityCount;

      recipe.ingredients.forEach(ing => {
        const itemIdx = updatedItems.findIndex(i => i.id === ing.productId);
        if (itemIdx === -1) return;
        const targetItem = updatedItems[itemIdx];
        
        // Total ingredient amount consumed
        const totalConsumed = ing.quantity * sale.quantityCount;
        const prevStock = targetItem.onHand;
        const newQty = Math.max(0, prevStock - totalConsumed);

        // Deduct batches FIFO
        const updatedBatches = [...(targetItem.batches || [])];
        const { updatedBatches: afterConsume } = consumeFromItemBatches(updatedBatches, totalConsumed);

        let newStatus: InventoryItem['status'] = 'Healthy';
        if (newQty === 0) newStatus = 'Zero Stock';
        else if (newQty < targetItem.min) newStatus = 'Low Stock';

        updatedItems[itemIdx] = {
          ...targetItem,
          onHand: newQty,
          batches: afterConsume,
          status: newStatus,
          daysLeft: targetItem.avgUsage > 0 ? Math.ceil(newQty / targetItem.avgUsage) : 99,
          updated: 'POS Sync completed'
        };

        newMovements.push({
          id: `mov-${Date.now()}-${Math.random()}`,
          date: todayStr,
          time: timeStr,
          itemName: targetItem.name,
          productId: targetItem.id,
          type: 'RECIPE_CONSUMPTION',
          quantity: -totalConsumed,
          unit: targetItem.unit,
          value: -totalConsumed * targetItem.cost,
          user: 'KDS Sync',
          previousStock: prevStock,
          newStock: newQty,
          reference: `POS-SALE-${Date.now().toString().slice(-4)}`,
          notes: `POS consumption from selling ${sale.quantityCount}x ${recipe.name}`
        });
      });
    });

    setItems(updatedItems);
    setStockMovements(prev => [...newMovements, ...prev]);
    showToast(`Simulated POS sales: consumed ingredients for ${successCount} dishes`, 'success');
    addActivity(`POS Sync: Sold ${successCount} recipes; recipe ingredients auto-deducted.`);
  };

  // 9. Stocktake counting with system freeze
  const finalizeStocktake = (
    physicalCounts: Record<string, number>, 
    area: string, 
    category: string,
    counterName: string
  ) => {
    const updatedItems = [...items];
    const newMovements: StockMovement[] = [];
    const todayStr = new Date().toISOString().substring(0, 10);
    const timeStr = new Date().toTimeString().substring(0, 5);
    
    let discrepancies = 0;
    let totalAudited = 0;
    let netVarianceCost = 0;

    Object.entries(physicalCounts).forEach(([itemId, physicalQty]) => {
      const idx = updatedItems.findIndex(i => i.id === itemId);
      if (idx === -1) return;
      
      const item = updatedItems[idx];
      totalAudited++;
      const expected = item.onHand;
      const diff = physicalQty - expected;

      if (diff !== 0) {
        discrepancies++;
        const valDiff = diff * item.cost;
        netVarianceCost += valDiff;

        // Perform stock correction via ledger
        const updatedBatches = [...(item.batches || [])];
        if (diff < 0) {
          const { updatedBatches: afterConsume } = consumeFromItemBatches(updatedBatches, Math.abs(diff));
          item.batches = afterConsume;
        } else {
          if (updatedBatches.length > 0) {
            updatedBatches[updatedBatches.length - 1].quantity += diff;
          } else {
            updatedBatches.push({
              id: `b-stk-${Date.now()}`,
              batchNumber: `STK-${Date.now().toString().slice(-4)}`,
              supplier: item.supplier,
              receivedDate: todayStr,
              expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
              quantity: diff,
              status: 'Healthy'
            });
          }
        }

        let newStatus: InventoryItem['status'] = 'Healthy';
        if (physicalQty === 0) newStatus = 'Zero Stock';
        else if (physicalQty < item.min) newStatus = 'Low Stock';

        updatedItems[idx] = {
          ...item,
          onHand: physicalQty,
          batches: updatedBatches,
          status: newStatus,
          expectedStock: expected,
          actualStock: physicalQty,
          varianceQty: diff,
          varianceCost: valDiff,
          daysLeft: item.avgUsage > 0 ? Math.ceil(physicalQty / item.avgUsage) : 99,
          updated: 'Stocktake completed'
        };

        newMovements.push({
          id: `mov-${Date.now()}-${Math.random()}`,
          date: todayStr,
          time: timeStr,
          itemName: item.name,
          productId: item.id,
          type: 'STOCKTAKE',
          quantity: diff,
          unit: item.unit,
          value: valDiff,
          user: counterName || 'Cyrus M.',
          previousStock: expected,
          newStock: physicalQty,
          reason: 'Physical Count Discrepancy',
          notes: `Stocktake audit in ${area}`
        });
      }
    });

    const accuracy = totalAudited > 0 ? Number(((totalAudited - discrepancies) / totalAudited * 100).toFixed(1)) : 100;

    const newRecord: StocktakeRecord = {
      id: `stk-${Date.now()}`,
      date: todayStr,
      itemsAudited: totalAudited,
      discrepancyCount: discrepancies,
      accuracyPercent: accuracy,
      status: 'Completed',
      varianceCost: netVarianceCost,
      area,
      category
    };

    setItems(updatedItems);
    if (newMovements.length > 0) {
      setStockMovements(prev => [...newMovements, ...prev]);
    }
    setStocktakes(prev => [newRecord, ...prev]);

    showToast(`Stocktake completed in ${area}. Accuracy: ${accuracy}%`, 'success');
    addActivity(`Completed Stocktake in ${area} by ${counterName || 'Cyrus M.'} (${discrepancies} variances)`);
  };

  // 10. Single Item CRUD Helpers
  const addNewItem = (newItem: Partial<InventoryItem>) => {
    const name = newItem.name || '';
    const sku = newItem.sku || `SKU-${Date.now().toString().slice(-4)}`;
    const category = newItem.category || 'Raw Meat';
    const supplier = newItem.supplier || 'Fresh Foods Ltd';
    const venue = newItem.venue || 'All Venues';
    const min = newItem.min || 10;
    const max = newItem.max || 50;
    const onHand = newItem.onHand || 0;
    const cost = newItem.cost || 0;
    const unit = newItem.unit || 'kg';
    const avgUsage = Math.floor(Math.random() * 5) + 1;
    const daysLeft = avgUsage > 0 ? Math.ceil(onHand / avgUsage) : 99;

    let status: InventoryItem['status'] = 'Healthy';
    if (onHand === 0) status = 'Zero Stock';
    else if (onHand < min) status = 'Low Stock';

    const created: InventoryItem = {
      id: `inv-${Date.now()}`,
      name,
      sku,
      category,
      supplier,
      venue,
      onHand,
      min,
      max,
      unit,
      cost,
      avgUsage,
      daysLeft,
      status,
      updated: 'Created just now',
      batches: onHand > 0 ? [{
        id: `b-init-${Date.now()}`,
        batchNumber: `BAT-INIT-${Date.now().toString().slice(-4)}`,
        supplier,
        receivedDate: new Date().toISOString().substring(0, 10),
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
        quantity: onHand,
        status: 'Healthy'
      }] : []
    };

    setItems(prev => [created, ...prev]);
    showToast(`Created item ${name}`, 'success');
    addActivity(`Created new item ${name} (${sku})`);
  };

  const updateItem = (updated: InventoryItem) => {
    setItems(prev => prev.map(item => item.id === updated.id ? { ...updated, updated: 'Modified just now' } : item));
    showToast(`Updated item ${updated.name}`, 'success');
  };

  const deleteItem = (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    setItems(prev => prev.filter(i => i.id !== id));
    showToast(`Deleted item ${item.name}`, 'info');
    addActivity(`Deleted inventory item ${item.name}`);
  };

  const togglePreferredSupplier = (supplierId: string) => {
    setSuppliers(prev => prev.map(s => s.id === supplierId ? { ...s, preferred: !s.preferred } : s));
  };

  return {
    // states
    items,
    purchaseOrders,
    suppliers,
    stockMovements,
    recipes,
    stocktakes,
    transfers,
    activityFeed,
    toast,
    setToast,

    // nav/tabs
    tab,
    setTab,

    // filters
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    supplierFilter,
    setSupplierFilter,
    venueFilter,
    setVenueFilter,
    statusFilter,
    setStatusFilter,
    stockLevelFilter,
    setStockLevelFilter,
    expiryFilter,
    setExpiryFilter,
    batchFilter,
    setBatchFilter,
    expiryStartFilter,
    setExpiryStartFilter,
    expiryEndFilter,
    setExpiryEndFilter,
    movementTypeFilter,
    setMovementTypeFilter,
    movementStartFilter,
    setMovementStartFilter,
    movementEndFilter,
    setMovementEndFilter,
    selectedRows,
    setSelectedRows,
    density,
    setDensity,

    // sorting & pagination
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,

    // mutators
    createPurchaseOrder,
    receivePOStock,
    quickReceiveStock,
    adjustStock,
    recordWaste,
    handleExpiredStock,
    createStockTransfer,
    receiveStockTransfer,
    rejectStockTransfer,
    simulateRecipeSales,
    finalizeStocktake,
    addNewItem,
    updateItem,
    deleteItem,
    togglePreferredSupplier,
    showToast
  };
}
