-- CreateTable
CREATE TABLE "generation_turns" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_turns_generationId_idx" ON "generation_turns"("generationId");

-- CreateIndex
CREATE UNIQUE INDEX "generation_turns_generationId_sequence_key" ON "generation_turns"("generationId", "sequence");

-- AddForeignKey
ALTER TABLE "generation_turns" ADD CONSTRAINT "generation_turns_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "resume_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
