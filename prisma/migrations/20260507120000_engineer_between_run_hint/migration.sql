-- CreateTable
CREATE TABLE "EngineerBetweenRunHint" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "primaryRunId" TEXT NOT NULL,
    "referenceRunId" TEXT,
    "inputFingerprint" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,

    CONSTRAINT "EngineerBetweenRunHint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngineerBetweenRunHint_primaryRunId_key" ON "EngineerBetweenRunHint"("primaryRunId");

-- CreateIndex
CREATE INDEX "EngineerBetweenRunHint_userId_updatedAt_idx" ON "EngineerBetweenRunHint"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "EngineerBetweenRunHint" ADD CONSTRAINT "EngineerBetweenRunHint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineerBetweenRunHint" ADD CONSTRAINT "EngineerBetweenRunHint_primaryRunId_fkey" FOREIGN KEY ("primaryRunId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
