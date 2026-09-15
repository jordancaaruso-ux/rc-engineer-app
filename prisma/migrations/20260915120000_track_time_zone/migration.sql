-- IANA zone of the venue, derived from the pin. The timing sweep has no phone to ask what day
-- it is; "today at this track" and "8 pm at this track" both read this column.
ALTER TABLE "Track" ADD COLUMN "timeZone" TEXT;
