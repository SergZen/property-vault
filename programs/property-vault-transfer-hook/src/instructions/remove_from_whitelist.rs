use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, WHITELIST_SEED};
use crate::{error::PropertyVaultTransferHookError, state::{Config, whitelist::Whitelist}};

#[derive(Accounts)]
#[instruction(user: Pubkey)]
pub struct RemoveFromWhitelist<'info> {
    #[account(
        mut,
        address = config.admin @ PropertyVaultTransferHookError::InvalidAdmin,
    )]
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [WHITELIST_SEED, user.as_ref()],
        close = admin,
        bump = whitelist.bump,
    )]
    pub whitelist: Account<'info, Whitelist>,
}

impl<'info> RemoveFromWhitelist<'info> {
    pub fn remove_from_whitelist(&mut self, user: Pubkey) -> Result<()> {
        msg!("Removing user from whitelist: {}", user);

        Ok(())
    }
}