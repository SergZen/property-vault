use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::{
        extension::{transfer_hook::TransferHookAccount, BaseStateWithExtensions, PodStateWithExtensions},
        pod::PodAccount,
    },
    token_interface::{Mint, TokenAccount},
};

use crate::constants::{EXTRA_ACCOUNT_METAS_SEED, WHITELIST_SEED};
use crate::error::PropertyVaultTransferHookError;
use crate::state::Whitelist;

#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint)]
    pub source_token_ata: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint)]
    pub destination_token_ata: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: authority перевода (владелец или delegate), хуку не нужен
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList
    #[account(
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// CHECK: PDA whitelist получателя; существование и содержимое проверяются в handler
    #[account(
        seeds = [WHITELIST_SEED, destination_token_ata.owner.as_ref()],
        bump,
    )]
    pub destination_whitelist: UncheckedAccount<'info>,
}

impl<'info> TransferHook<'info> {
    pub fn transfer_hook(&mut self, _amount: u64) -> Result<()> {
        self.check_is_transferring()?;

        let info = self.destination_whitelist.to_account_info();
        require_keys_eq!(
            *info.owner,
            crate::ID,
            PropertyVaultTransferHookError::NotWhitelisted
        );
        let data = info.try_borrow_data()?;
        let whitelist = Whitelist::try_deserialize(&mut &data[..])
            .map_err(|_| error!(PropertyVaultTransferHookError::NotWhitelisted))?;
        require_keys_eq!(
            whitelist.address,
            self.destination_token_ata.owner,
            PropertyVaultTransferHookError::NotWhitelisted
        );

        Ok(())
    }

    fn check_is_transferring(&self) -> Result<()> {
        let source_token_info = self.source_token_ata.to_account_info();
        let account_data = source_token_info.try_borrow_data()?;
        let account = PodStateWithExtensions::<PodAccount>::unpack(&account_data)?;
        let account_extension = account.get_extension::<TransferHookAccount>()?;

        require!(
            bool::from(account_extension.transferring),
            PropertyVaultTransferHookError::NotTransferring
        );

        Ok(())
    }
}
