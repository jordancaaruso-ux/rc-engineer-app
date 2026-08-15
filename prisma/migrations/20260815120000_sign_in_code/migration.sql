-- CreateTable
CREATE TABLE "SignInCode" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignInCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignInCode_identifier_idx" ON "SignInCode"("identifier");

-- CreateIndex
CREATE INDEX "SignInCode_expires_idx" ON "SignInCode"("expires");
