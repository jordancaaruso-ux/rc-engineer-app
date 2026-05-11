-- CreateTable
CREATE TABLE "EngineerDashboardSuggestion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "primaryRunId" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,

    CONSTRAINT "EngineerDashboardSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngineerDashboardSuggestion_primaryRunId_key" ON "EngineerDashboardSuggestion"("primaryRunId");

-- CreateIndex
CREATE INDEX "EngineerDashboardSuggestion_userId_updatedAt_idx" ON "EngineerDashboardSuggestion"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "EngineerDashboardSuggestion" ADD CONSTRAINT "EngineerDashboardSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineerDashboardSuggestion" ADD CONSTRAINT "EngineerDashboardSuggestion_primaryRunId_fkey" FOREIGN KEY ("primaryRunId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
