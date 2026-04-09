-- Add mcap_coins column (circulating supply in coins) to all event tables
-- mcap_usd is kept as-is and continues to be populated during approve

alter table events_pending      add column if not exists mcap_coins numeric;
alter table events_approved     add column if not exists mcap_coins numeric;
alter table auto_events_pending add column if not exists mcap_coins numeric;
