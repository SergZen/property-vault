use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct InvestmentPool {
    pub property: Pubkey,
    pub vault: Pubkey,
    pub total_raised: u64,
    pub total_withdrawn: u64,
    pub bump: u8,
}