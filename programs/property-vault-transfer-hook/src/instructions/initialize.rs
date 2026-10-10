use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::state::Config;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        seeds = [CONFIG_SEED],
        bump,
        payer = admin,
        space = Config::DISCRIMINATOR.len() + Config::INIT_SPACE,
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    pub fn initialize_config(&mut self, bumps: &InitializeBumps) -> Result<()> {
        self.config.set_inner(Config {
            admin: self.admin.key(),
            bump: bumps.config,
        });

        Ok(())
    }
}
