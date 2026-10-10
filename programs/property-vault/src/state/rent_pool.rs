use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct RentPool {
    pub property: Pubkey,
    pub vault: Pubkey,
    pub current_period: u64,
    pub total_deposited: u64,
    pub bump: u8,
}