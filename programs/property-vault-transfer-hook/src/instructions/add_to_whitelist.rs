use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, WHITELIST_SEED};
use crate::{error::PropertyVaultTransferHookError, Config, Whitelist};

#[derive(Accounts)]
#[instruction(user: Pubkey)]
pub struct AddToWhitelist<'info> {
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
        init,
        payer = admin,
        space = Whitelist::DISCRIMINATOR.len() + Whitelist::INIT_SPACE,
        seeds = [WHITELIST_SEED, user.as_ref()],
        bump,
    )]
    pub whitelist: Account<'info, Whitelist>,
    pub system_program: Program<'info, System>,
}

impl<'info> AddToWhitelist<'info> {
    pub fn add_to_whitelist(&mut self, user: Pubkey, bumps: &AddToWhitelistBumps) -> Result<()> {
        self.whitelist.set_inner(Whitelist {
            address: user,
            bump: bumps.whitelist,
        });

        msg!("Adding user to whitelist: {}", user);

        Ok(())
    }
}