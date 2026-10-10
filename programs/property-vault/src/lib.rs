use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("Gr3Wbf8LDvcsMup4NRSMEMgMbd3QXATEgL2ZvyMze4zM");

#[program]
pub mod property_vault {
    use super::*;

    pub fn list_and_tokenize_property(
        ctx: Context<ListAndTokenizeProperty>,
        args: ListArgs,
    ) -> Result<()> {
        ctx.accounts.handle_list_and_tokenize_property(args, &ctx.bumps)
    }

    pub fn invest(ctx: Context<Invest>) -> Result<()> {
        ctx.accounts.handle_invest()
    }

    pub fn withdraw_raised_capital(ctx: Context<WithdrawRaisedCapital>) -> Result<()> {
        ctx.accounts.handle_withdraw_raised_capital()
    }

    pub fn pay_rent(ctx: Context<PayRent>) -> Result<()> {
        ctx.accounts.handle_pay_rent()
    }

    pub fn claim_rent(ctx: Context<ClaimRent>) -> Result<()> {
        ctx.accounts.handle_claim_rent()
    }
}