-- CreateTable
CREATE TABLE "Table19ValidationRun" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetAt" TIMESTAMP(3),
    "resetByStaffId" TEXT,

    CONSTRAINT "Table19ValidationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Table19ValidationRun_orderId_key" ON "Table19ValidationRun"("orderId");

-- CreateIndex
CREATE INDEX "Table19ValidationRun_venueId_resetAt_idx" ON "Table19ValidationRun"("venueId", "resetAt");

-- AddForeignKey
ALTER TABLE "Table19ValidationRun" ADD CONSTRAINT "Table19ValidationRun_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table19ValidationRun" ADD CONSTRAINT "Table19ValidationRun_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
