use anchor_lang::prelude::*;

use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::constants::{EXTRA_ACCOUNT_METAS_SEED, WHITELIST_SEED};
use crate::error::PropertyVaultTransferHookError;

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: ExtraAccountMetaList account, создаётся здесь и заполняется через ExtraAccountMetaList::init
    #[account(
        init,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump,
        space = ExtraAccountMetaList::size_of(
            InitializeExtraAccountMetaList::extra_account_metas()?.len()
        ).unwrap(),
        payer = payer
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeExtraAccountMetaList<'info> {
    pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
        Ok(vec![ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: WHITELIST_SEED.to_vec(),
                },
                Seed::AccountData {
                    account_index: 2,
                    data_index: 32,
                    length: 32,
                },
            ],
            false,
            false,
        )
        .map_err(|_| error!(PropertyVaultTransferHookError::ExtraAccountMetaError))?])
    }

    pub fn initialize_extra_account_meta_list(&mut self) -> Result<()> {
        let extra_account_metas = Self::extra_account_metas()?;

        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut self.extra_account_meta_list.try_borrow_mut_data()?,
            &extra_account_metas,
        )
        .map_err(|_| error!(PropertyVaultTransferHookError::ExtraAccountMetaError))?;

        Ok(())
    }
}
