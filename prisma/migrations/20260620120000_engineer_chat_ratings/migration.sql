-- CreateTable
CREATE TABLE "EngineerChatThread" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "primaryRunId" TEXT,
    "compareRunId" TEXT,

    CONSTRAINT "EngineerChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineerChatMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadataJson" JSONB,

    CONSTRAINT "EngineerChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineerMessageRating" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "note" TEXT,
    "contextSnapshot" JSONB NOT NULL,

    CONSTRAINT "EngineerMessageRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngineerChatThread_userId_updatedAt_idx" ON "EngineerChatThread"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "EngineerChatMessage_threadId_createdAt_idx" ON "EngineerChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "EngineerMessageRating_userId_updatedAt_idx" ON "EngineerMessageRating"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "EngineerMessageRating_createdAt_idx" ON "EngineerMessageRating"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngineerMessageRating_messageId_userId_key" ON "EngineerMessageRating"("messageId", "userId");

-- AddForeignKey
ALTER TABLE "EngineerChatThread" ADD CONSTRAINT "EngineerChatThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineerChatMessage" ADD CONSTRAINT "EngineerChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EngineerChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineerMessageRating" ADD CONSTRAINT "EngineerMessageRating_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EngineerChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineerMessageRating" ADD CONSTRAINT "EngineerMessageRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
