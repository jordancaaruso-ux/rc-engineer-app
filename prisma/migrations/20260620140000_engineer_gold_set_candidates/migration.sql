-- CreateTable
CREATE TABLE "EngineerGoldSetCandidate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "assistantMessageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "question" TEXT NOT NULL,
    "questionHash" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "runId" TEXT,
    "compareRunId" TEXT,
    "kbSections" JSONB,
    "source" TEXT,
    "reviewerJson" JSONB,
    "reviewerReviewedAt" TIMESTAMP(3),
    "promotedAt" TIMESTAMP(3),
    "promotedCaseId" TEXT,

    CONSTRAINT "EngineerGoldSetCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngineerGoldSetCandidate_assistantMessageId_key" ON "EngineerGoldSetCandidate"("assistantMessageId");

-- CreateIndex
CREATE INDEX "EngineerGoldSetCandidate_status_createdAt_idx" ON "EngineerGoldSetCandidate"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EngineerGoldSetCandidate_questionHash_idx" ON "EngineerGoldSetCandidate"("questionHash");

-- CreateIndex
CREATE INDEX "EngineerGoldSetCandidate_userId_createdAt_idx" ON "EngineerGoldSetCandidate"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "EngineerGoldSetCandidate" ADD CONSTRAINT "EngineerGoldSetCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
