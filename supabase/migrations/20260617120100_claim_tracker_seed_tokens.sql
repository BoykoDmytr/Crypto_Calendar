-- ============================================================
-- Seed: verified tokens (June 2026).
-- 3 tracked community-claim tokens (OFC, SOSO, OPG) + 2 EXCLUDED
-- insider/vesting unlocks (VANA, ME) kept as honest negative examples.
-- ============================================================

-- OFC — OneFootball Club (Base) — monthly vesting claim
with t as (
  insert into claim_tokens (symbol,name,project,coingecko_slug,is_community_claim,cadence,status,notes)
  values ('OFC','OneFootball Club','OneFootball','onefootball-club',true,'monthly','tracked',
          'Portal fanpass.onefootball.com. Multiple distributors: TGE, monthly vesting, leaderboard.')
  returning id)
insert into claim_token_chains (token_id,chain,token_address,explorer_api,is_primary)
select id,'base','0x752c5a95d202972e124390f30a50154409d3c858','https://base.blockscout.com/api',true from t;

insert into claim_distributors (token_id,chain,address,verified_name,role,watch)
select id,'base','0x06821F0A313871eBDCD5B2D4A56f2b7dB8853B00','AirdropAndVesting','tge',true   from claim_tokens where symbol='OFC';
insert into claim_distributors (token_id,chain,address,verified_name,role,watch)
select id,'base','0xaD6C87E99547c7C2F610088dfC7d6d2C8BCa74Ff','VestingRescue','vesting',true     from claim_tokens where symbol='OFC';
insert into claim_distributors (token_id,chain,address,verified_name,role,watch)
select id,'base','0xaF24A84fed23966D81dAAC2D9CadDbba64DD1593','MetagameRewards','rewards',true   from claim_tokens where symbol='OFC';

-- SOSO — SoSoValue (ETH -> Base -> ValueChain L1) — per-epoch claims
with t as (
  insert into claim_tokens (symbol,name,project,coingecko_slug,is_community_claim,cadence,status,notes)
  values ('SOSO','SoSoValue','SoSoValue / SoDEX','sosovalue',true,'per-epoch','tracked',
          'Migrated to own L1 ValueChain Oct 2025. Reusable claim hub via new merkle roots. Claims ~12:00 UTC.')
  returning id)
insert into claim_token_chains (token_id,chain,token_address,explorer_api,is_primary)
select id,'valuechain',null,'https://main-scan.valuechain.xyz/api',true from t;
insert into claim_token_chains (token_id,chain,token_address,explorer_api,is_primary)
select id,'base','0x624e2e7fdc8903165f64891672267ab0fcb98831','https://base.blockscout.com/api',false from claim_tokens where symbol='SOSO';
insert into claim_token_chains (token_id,chain,token_address,explorer_api,is_primary)
select id,'ethereum','0x76a0e27618462bdac7a29104bdcfff4e6bfcea2d','https://eth.blockscout.com/api',false from claim_tokens where symbol='SOSO';

insert into claim_distributors (token_id,chain,address,verified_name,role,method_selector,watch)
select id,'valuechain','0x4fcDdE852787B090DC55f7aFDA02c1eC0D907449','ClaimHub (ERC1967Proxy)','hub','0x88918c42',true from claim_tokens where symbol='SOSO';
insert into claim_distributors (token_id,chain,address,verified_name,role,watch)
select id,'base','0x40Fb04bBf5124Ea4b25fc18A839524A725Cabf9c','SoSoValueEpoch2Airdrop','vesting',false from claim_tokens where symbol='SOSO';

-- OPG — OpenGradient (Base) — per-tranche, new contract each time
with t as (
  insert into claim_tokens (symbol,name,project,coingecko_slug,is_community_claim,cadence,status,notes)
  values ('OPG','OpenGradient','OpenGradient','opengradient',true,'per-tranche','tracked',
          'New distributor per tranche (Sablier, then TokenTable). Watch deployer 0x81F7cA6A...1415.')
  returning id)
insert into claim_token_chains (token_id,chain,token_address,explorer_api,is_primary)
select id,'base','0xFbC2051AE2265686a469421b2C5A2D5462FbF5eB','https://base.blockscout.com/api',true from t;

insert into claim_distributors (token_id,chain,address,verified_name,role,watch)
select id,'base','0x455FFBB015F956Aa663B9c30432528C3a7bF9783','SablierMerkleInstant','tge',false from claim_tokens where symbol='OPG';
insert into claim_distributors (token_id,chain,address,verified_name,role,watch)
select id,'base','0x28dc829e5EDa7c3899557416b8fC97E6873a55aa','MerkleDistributor (TokenTable)','vesting',true from claim_tokens where symbol='OPG';

-- ---------- EXCLUDED: verified NOT community claims ----------
with t as (
  insert into claim_tokens (symbol,name,project,coingecko_slug,is_community_claim,cadence,status,notes)
  values ('VANA','Vana','Vana','vana',false,'none','excluded',
          'EXCLUDED: June 16 2026 is a linear vesting unlock (foundation/contributor tranches), not a user claim. 20+ VestingWallet contracts; no tx spike. Only real community claim = TGE airdrop Dec 2024 (closed). "Airdrop"-named contracts on vanascan are decoys distributing 3rd-party DataDAO memes.')
  returning id)
insert into claim_token_chains (token_id,chain,token_address,explorer_api,is_primary)
select id,'vana',null,'https://vanascan.io/api',true from t;
insert into claim_token_chains (token_id,chain,token_address,explorer_api,is_primary)
select id,'ethereum','0x7ff7fa94b8b66ef313f7970d4eebd2cb3103a2c0','https://eth.blockscout.com/api',false from claim_tokens where symbol='VANA';

with t as (
  insert into claim_tokens (symbol,name,project,coingecko_slug,is_community_claim,cadence,status,notes)
  values ('ME','Magic Eden','Magic Eden','magic-eden',false,'one-time','excluded',
          'EXCLUDED: June 10 2026 unlock is ~94% Contributors (insider vesting cliff), Community only 6.96M ME. Only real community claim = Dec 10 2024 - Feb 1 2025 (closed). Solana SPL, free on-chain verification not available.')
  returning id)
insert into claim_token_chains (token_id,chain,token_address,explorer_api,is_primary)
select id,'solana','MEFNBXixkEbait3xn9bkm8WsJzXtVsaJEn4c8Sam21u',null,true from t;
