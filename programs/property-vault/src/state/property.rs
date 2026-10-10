use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Property {
    pub owner: Pubkey,
    pub property_id: u64,
    pub valuation: u64,
    pub token_supply: u64,
    pub token_price: u64,
    pub monthly_rent: u64,
    pub terms_version: u32,
    pub terms_hash: [u8; 32],
    pub mint: Pubkey,
    pub payment_mint: Pubkey,
    pub investment_pool: Pubkey,
    pub rent_pool: Pubkey,
    pub inventory: Pubkey,
    pub tokens_sold: u64,
    pub status: PropertyStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PropertyStatus {
    Tokenized,
}