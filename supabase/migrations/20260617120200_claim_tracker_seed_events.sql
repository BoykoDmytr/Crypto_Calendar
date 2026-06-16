-- ============================================================
-- Seed: verified historical claim events (ground truth, June 2026).
-- Populates /claims immediately; the watcher keeps live ones fresh.
-- amounts in whole tokens; pct_claimed is 0..100.
-- ============================================================

-- SOSO ----------------------------------------------------------------
insert into claim_events (token_id,distributor_id,label,chain,status,actual_start_utc,promised_date,first_tx_hash,claims_count,amount_pool,amount_claimed,pct_claimed,dedup_key)
select (select id from claim_tokens where symbol='SOSO'), null,
       'Season 1 (TGE)','ethereum','completed','2025-01-24 08:05:11+00',null,
       '0x640cB7201810BC920835A598248c4fe4898Bb5e0', 129450, 15000020, 13283700, 88.6, 'SOSO:2025-01';

insert into claim_events (token_id,distributor_id,label,chain,status,actual_start_utc,claims_count,amount_pool,amount_claimed,pct_claimed,dedup_key)
select (select id from claim_tokens where symbol='SOSO'), null,
       'Epoch 1','base','completed','2025-03-06 10:20:11+00', 30847, 30000020, 29543261, 98.5, 'SOSO:2025-03';

insert into claim_events (token_id,distributor_id,label,chain,status,actual_start_utc,claims_count,amount_pool,amount_claimed,pct_claimed,dedup_key)
select (select id from claim_tokens where symbol='SOSO'),
       (select id from claim_distributors where address='0x40Fb04bBf5124Ea4b25fc18A839524A725Cabf9c'),
       'Epoch 2','base','completed','2025-06-06 12:00:05+00', 18870, 30001000, 28813056, 96.0, 'SOSO:2025-06';

insert into claim_events (token_id,distributor_id,label,chain,status,actual_start_utc,claims_count,amount_pool,amount_claimed,pct_claimed,dedup_key)
select (select id from claim_tokens where symbol='SOSO'),
       (select id from claim_distributors where address='0x4fcDdE852787B090DC55f7aFDA02c1eC0D907449'),
       'SSI Epoch 3','valuechain','completed','2026-02-13 12:00:00+00', 9628, 31000000, 31000000, 100, 'SOSO:2026-02';

insert into claim_events (token_id,distributor_id,label,chain,status,actual_start_utc,amount_pool,amount_claimed,pct_claimed,dedup_key)
select (select id from claim_tokens where symbol='SOSO'),
       (select id from claim_distributors where address='0x4fcDdE852787B090DC55f7aFDA02c1eC0D907449'),
       'Testnet Patch','valuechain','completed','2026-05-08 12:00:00+00', 30000000, 30000000, 100, 'SOSO:2025-05-patch';

insert into claim_events (token_id,distributor_id,label,chain,status,actual_start_utc,claims_count,amount_pool,amount_claimed,pct_claimed,dedup_key)
select (select id from claim_tokens where symbol='SOSO'),
       (select id from claim_distributors where address='0x4fcDdE852787B090DC55f7aFDA02c1eC0D907449'),
       'S2 EXP','valuechain','verified','2026-06-12 12:43:18+00', 44000, 30000000, 4260000, 14.2, 'SOSO:2026-06';

-- OFC ----------------------------------------------------------------
insert into claim_events (token_id,distributor_id,label,chain,status,actual_start_utc,claims_count,amount_pool,amount_claimed,pct_claimed,dedup_key)
select (select id from claim_tokens where symbol='OFC'),
       (select id from claim_distributors where address='0x06821F0A313871eBDCD5B2D4A56f2b7dB8853B00'),
       'TGE Airdrop','base','completed','2026-04-09 11:05:55+00', 10000, 9070000, 9070000, 100, 'OFC:2026-04';

insert into claim_events (token_id,distributor_id,label,chain,status,promised_date,claims_count,amount_pool,amount_claimed,pct_claimed,dedup_key)
select (select id from claim_tokens where symbol='OFC'),
       (select id from claim_distributors where address='0xaD6C87E99547c7C2F610088dfC7d6d2C8BCa74Ff'),
       'Vesting #1','base','completed','2026-05-09', 9997, 8280000, 8280000, 100, 'OFC:2026-05';

insert into claim_events (token_id,distributor_id,label,chain,status,actual_start_utc,first_tx_hash,claims_count,amount_pool,amount_claimed,pct_claimed,next_predicted,dedup_key)
select (select id from claim_tokens where symbol='OFC'),
       (select id from claim_distributors where address='0xaD6C87E99547c7C2F610088dfC7d6d2C8BCa74Ff'),
       'Vesting #2','base','completed','2026-06-08 04:40:15+00',
       '0x10db327fdd0cc778b5bc2f467b51f83365909406b24789cbed2015ee8cc161a5', 14500, 11900000, 11900000, 100, '2026-07-08', 'OFC:2026-06';

-- OPG ----------------------------------------------------------------
insert into claim_events (token_id,distributor_id,label,chain,status,actual_start_utc,amount_pool,amount_claimed,pct_claimed,dedup_key)
select (select id from claim_tokens where symbol='OPG'),
       (select id from claim_distributors where address='0x455FFBB015F956Aa663B9c30432528C3a7bF9783'),
       'TGE (Sablier)','base','completed','2026-04-21 12:30:09+00', 2110000, 2030000, 95.9, 'OPG:2026-04';

insert into claim_events (token_id,distributor_id,label,chain,status,promised_date,claims_count,amount_pool,amount_claimed,pct_claimed,dedup_key)
select (select id from claim_tokens where symbol='OPG'),
       (select id from claim_distributors where address='0x28dc829e5EDa7c3899557416b8fC97E6873a55aa'),
       'May tranche (TokenTable)','base','completed','2026-05-15', 25, 500000, 391000, 78.0, 'OPG:2026-05';

-- on-chain source links (one per event) -----------------------------
insert into claim_event_sources (event_id,source_type,url,detail)
select id,'onchain','https://eth.blockscout.com/address/0x640cB7201810BC920835A598248c4fe4898Bb5e0','Season 1 distributor (Ethereum)' from claim_events where dedup_key='SOSO:2025-01';
insert into claim_event_sources (event_id,source_type,url,detail)
select id,'onchain','https://base.blockscout.com/address/0xBFe59c8e842c4564558c558f8428A65609F133C5','Epoch 1 distributor (Base)' from claim_events where dedup_key='SOSO:2025-03';
insert into claim_event_sources (event_id,source_type,url,detail)
select id,'onchain','https://base.blockscout.com/address/0x40Fb04bBf5124Ea4b25fc18A839524A725Cabf9c','Epoch 2 airdrop (Base)' from claim_events where dedup_key='SOSO:2025-06';
insert into claim_event_sources (event_id,source_type,url,detail)
select id,'onchain','https://main-scan.valuechain.xyz/address/0x4fcDdE852787B090DC55f7aFDA02c1eC0D907449','Reusable claim hub (ValueChain)' from claim_events where dedup_key in ('SOSO:2026-02','SOSO:2025-05-patch','SOSO:2026-06');
insert into claim_event_sources (event_id,source_type,url,detail)
select id,'onchain','https://base.blockscout.com/address/0x06821F0A313871eBDCD5B2D4A56f2b7dB8853B00','AirdropAndVesting TGE (Base)' from claim_events where dedup_key='OFC:2026-04';
insert into claim_event_sources (event_id,source_type,url,detail)
select id,'onchain','https://base.blockscout.com/address/0xaD6C87E99547c7C2F610088dfC7d6d2C8BCa74Ff','VestingRescue monthly (Base)' from claim_events where dedup_key='OFC:2026-05';
insert into claim_event_sources (event_id,source_type,url,detail)
select id,'onchain','https://base.blockscout.com/tx/0x10db327fdd0cc778b5bc2f467b51f83365909406b24789cbed2015ee8cc161a5','First claim tx (Base)' from claim_events where dedup_key='OFC:2026-06';
insert into claim_event_sources (event_id,source_type,url,detail)
select id,'onchain','https://base.blockscout.com/address/0x455FFBB015F956Aa663B9c30432528C3a7bF9783','SablierMerkleInstant TGE (Base)' from claim_events where dedup_key='OPG:2026-04';
insert into claim_event_sources (event_id,source_type,url,detail)
select id,'onchain','https://base.blockscout.com/address/0x28dc829e5EDa7c3899557416b8fC97E6873a55aa','TokenTable MerkleDistributor (Base)' from claim_events where dedup_key='OPG:2026-05';
