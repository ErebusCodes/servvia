-- DropForeignKey
ALTER TABLE "KdsDeliveryRecord" DROP CONSTRAINT "KdsDeliveryRecord_orderId_fkey";

-- AddForeignKey
ALTER TABLE "KdsDeliveryRecord" ADD CONSTRAINT "KdsDeliveryRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
