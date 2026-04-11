-- CreateTable
CREATE TABLE "TeammateLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "peerUserId" TEXT NOT NULL,

    CONSTRAINT "TeammateLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeammateLink_userId_peerUserId_key" ON "TeammateLink"("userId", "peerUserId");

-- CreateIndex
CREATE INDEX "TeammateLink_userId_idx" ON "TeammateLink"("userId");

-- CreateIndex
CREATE INDEX "TeammateLink_peerUserId_idx" ON "TeammateLink"("peerUserId");

-- AddForeignKey
ALTER TABLE "TeammateLink" ADD CONSTRAINT "TeammateLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateLink" ADD CONSTRAINT "TeammateLink_peerUserId_fkey" FOREIGN KEY ("peerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
