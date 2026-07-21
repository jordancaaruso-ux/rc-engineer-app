-- CreateTable
CREATE TABLE "NativePushDevice" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "lastNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "NativePushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NativePushDevice_token_key" ON "NativePushDevice"("token");

-- CreateIndex
CREATE INDEX "NativePushDevice_userId_idx" ON "NativePushDevice"("userId");

-- AddForeignKey
ALTER TABLE "NativePushDevice" ADD CONSTRAINT "NativePushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
