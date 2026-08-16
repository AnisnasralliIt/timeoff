-- CreateTable
CREATE TABLE "AuthorisationPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlyAllowance" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "minRequestHours" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "maxRequestHours" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "requestIncrementHours" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "carryOverEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxCarryOverHours" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "prorateFirstMonth" BOOLEAN NOT NULL DEFAULT false,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorisationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorisationBalance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "granted" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carriedOver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "used" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorisationBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorisationRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorisationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorisationAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorisationAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthorisationPolicy_companyId_key" ON "AuthorisationPolicy"("companyId");

-- CreateIndex
CREATE INDEX "AuthorisationBalance_companyId_idx" ON "AuthorisationBalance"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorisationBalance_userId_period_key" ON "AuthorisationBalance"("userId", "period");

-- CreateIndex
CREATE INDEX "AuthorisationRequest_companyId_status_idx" ON "AuthorisationRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "AuthorisationRequest_companyId_userId_idx" ON "AuthorisationRequest"("companyId", "userId");

-- CreateIndex
CREATE INDEX "AuthorisationRequest_date_idx" ON "AuthorisationRequest"("date");

-- CreateIndex
CREATE INDEX "AuthorisationAdjustment_companyId_userId_idx" ON "AuthorisationAdjustment"("companyId", "userId");

-- CreateIndex
CREATE INDEX "AuthorisationAdjustment_userId_period_idx" ON "AuthorisationAdjustment"("userId", "period");

-- AddForeignKey
ALTER TABLE "AuthorisationPolicy" ADD CONSTRAINT "AuthorisationPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorisationBalance" ADD CONSTRAINT "AuthorisationBalance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorisationBalance" ADD CONSTRAINT "AuthorisationBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorisationRequest" ADD CONSTRAINT "AuthorisationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorisationRequest" ADD CONSTRAINT "AuthorisationRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorisationRequest" ADD CONSTRAINT "AuthorisationRequest_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorisationRequest" ADD CONSTRAINT "AuthorisationRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorisationAdjustment" ADD CONSTRAINT "AuthorisationAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorisationAdjustment" ADD CONSTRAINT "AuthorisationAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
