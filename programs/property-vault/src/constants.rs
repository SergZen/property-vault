use anchor_lang::prelude::*;

#[constant]
pub const PROPERTY_SEED: &[u8] = b"property";

#[constant]
pub const PROPERTY_MINT_SEED: &[u8] = b"property_mint";

#[constant]
pub const INVESTMENT_POOL_SEED: &[u8] = b"investment_pool";

#[constant]
pub const INVESTMENT_VAULT_SEED: &[u8] = b"investment_vault";

#[constant]
pub const POSITION_SEED: &[u8] = b"position";

#[constant]
pub const RENT_POOL_SEED: &[u8] = b"rent_pool";

#[constant]
pub const RENT_CLAIM_SEED: &[u8] = b"rent_claim";

#[constant]
pub const RENT_VAULT_SEED: &[u8] = b"rent_vault";

#[constant]
pub const DECIMALS: u8 = 0;