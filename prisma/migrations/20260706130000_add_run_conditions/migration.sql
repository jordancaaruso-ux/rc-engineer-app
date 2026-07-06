-- AlterTable
ALTER TABLE "Run" ADD COLUMN "conditionsAirTempC" DOUBLE PRECISION,
ADD COLUMN "conditionsTrackTempC" DOUBLE PRECISION,
ADD COLUMN "conditionsCloudCoverPct" INTEGER,
ADD COLUMN "conditionsWeatherCode" INTEGER,
ADD COLUMN "conditionsHumidityPct" INTEGER,
ADD COLUMN "conditionsWindKph" DOUBLE PRECISION,
ADD COLUMN "conditionsWindDirDeg" INTEGER,
ADD COLUMN "conditionsSource" TEXT,
ADD COLUMN "conditionsLatitude" DOUBLE PRECISION,
ADD COLUMN "conditionsLongitude" DOUBLE PRECISION,
ADD COLUMN "conditionsObservedAt" TIMESTAMP(3);
