use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::associated_token::{
    create as create_ata, get_associated_token_address_with_program_id, AssociatedToken,
    Create as CreateAta,
};
use anchor_spl::token_2022::spl_token_2022::{extension::ExtensionType, state::Mint as SplMint};
use anchor_spl::token_interface::{
    initialize_mint2, mint_to, transfer_hook_initialize, InitializeMint2, Mint, MintTo, Token2022,
    TokenAccount, TokenInterface, TransferHookInitialize,
};

use crate::error::PropertyVaultError;
use crate::{constants::*, InvestmentPool, Property, PropertyStatus, RentPool};

use property_vault_transfer_hook::ID as HOOK_PROGRAM_ID;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ListArgs {
    pub property_id: u64,
    pub valuation: u64,
    pub token_supply: u64,
    pub token_price: u64,
    pub monthly_rent: u64,
    pub terms_version: u32,
    pub terms_hash: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: ListArgs)]
pub struct ListAndTokenizeProperty<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = Property::DISCRIMINATOR.len() + Property::INIT_SPACE,
        seeds = [PROPERTY_SEED, owner.key().as_ref(), &args.property_id.to_le_bytes()],
        bump
    )]
    pub property: Account<'info, Property>,

    /// CHECK:
    #[account(mut, seeds = [PROPERTY_MINT_SEED, property.key().as_ref()], bump)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK:
    #[account(
        mut,
        address = get_associated_token_address_with_program_id(
            &property.key(),
            &mint.key(),
            &token_program.key()
        )
    )]
    pub inventory: UncheckedAccount<'info>,

    #[account(mint::token_program = payment_token_program)]
    pub payment_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = owner,
        space = InvestmentPool::DISCRIMINATOR.len() + InvestmentPool::INIT_SPACE,
        seeds = [INVESTMENT_POOL_SEED, property.key().as_ref()],
        bump
    )]
    pub investment_pool: Box<Account<'info, InvestmentPool>>,

    #[account(
        init,
        payer = owner,
        space = RentPool::DISCRIMINATOR.len() + RentPool::INIT_SPACE,
        seeds = [RENT_POOL_SEED, property.key().as_ref()],
        bump
    )]
    pub rent_pool: Box<Account<'info, RentPool>>,

    #[account(
        init,
        payer = owner,
        seeds = [INVESTMENT_VAULT_SEED, property.key().as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = investment_pool,
        token::token_program = payment_token_program
    )]
    pub investment_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = owner,
        seeds = [RENT_VAULT_SEED, property.key().as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = rent_pool,
        token::token_program = payment_token_program
    )]
    pub rent_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK:
    #[account(address = HOOK_PROGRAM_ID)]
    pub hook_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub payment_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> ListAndTokenizeProperty<'info> {
    pub fn handle_list_and_tokenize_property(
        &mut self,
        args: ListArgs,
        bumps: &ListAndTokenizePropertyBumps,
    ) -> Result<()> {
        require!(
            args.valuation > 0
                && args.token_supply > 0
                && args.token_price > 0
                && args.monthly_rent > 0,
            PropertyVaultError::InvalidConfig
        );

        let property_key: Pubkey = self.property.key();
        let mint_key = self.mint.key();
        let mint_bump = bumps.mint;
        let mint_seeds: &[&[u8]] = &[PROPERTY_MINT_SEED, property_key.as_ref(), &[mint_bump]];

        let space =
            ExtensionType::try_calculate_account_len::<SplMint>(&[ExtensionType::TransferHook])?;
        let lamports = Rent::get()?.minimum_balance(space);

        create_account(
            CpiContext::new_with_signer(
                self.system_program.key(),
                CreateAccount {
                    from: self.owner.to_account_info(),
                    to: self.mint.to_account_info(),
                },
                &[mint_seeds],
            ),
            lamports,
            space as u64,
            &self.token_program.key(),
        )?;

        transfer_hook_initialize(
            CpiContext::new(
                self.token_program.key(),
                TransferHookInitialize {
                    token_program_id: self.token_program.to_account_info(),
                    mint: self.mint.to_account_info(),
                },
            ),
            Some(property_key),
            Some(self.hook_program.key()),
        )?;

        initialize_mint2(
            CpiContext::new(
                self.token_program.key(),
                InitializeMint2 {
                    mint: self.mint.to_account_info(),
                },
            ),
            DECIMALS,
            &property_key,
            None,
        )?;

        create_ata(CpiContext::new(
            self.associated_token_program.key(),
            CreateAta {
                payer: self.owner.to_account_info(),
                associated_token: self.inventory.to_account_info(),
                authority: self.property.to_account_info(),
                mint: self.mint.to_account_info(),
                system_program: self.system_program.to_account_info(),
                token_program: self.token_program.to_account_info(),
            },
        ))?;

        let owner_key = self.owner.key();
        let property_id_bytes = args.property_id.to_le_bytes();
        let property_bump = bumps.property;
        let property_seeds: &[&[u8]] = &[
            PROPERTY_SEED,
            owner_key.as_ref(),
            &property_id_bytes,
            &[property_bump],
        ];
        
        mint_to(
            CpiContext::new_with_signer(
                self.token_program.key(),
                MintTo {
                    mint: self.mint.to_account_info(),
                    to: self.inventory.to_account_info(),
                    authority: self.property.to_account_info(),
                },
                &[property_seeds],
            ),
            args.token_supply,
        )?;

        let investment_pool_key = self.investment_pool.key();
        let rent_pool_key = self.rent_pool.key();
        let inventory_key = self.inventory.key();

        self.property.set_inner(Property {
            owner: owner_key,
            property_id: args.property_id,
            valuation: args.valuation,
            token_supply: args.token_supply,
            token_price: args.token_price,
            monthly_rent: args.monthly_rent,
            terms_version: args.terms_version,
            terms_hash: args.terms_hash,
            mint: mint_key,
            payment_mint: self.payment_mint.key(),
            investment_pool: investment_pool_key,
            rent_pool: rent_pool_key,
            inventory: inventory_key,
            tokens_sold: 0,
            status: PropertyStatus::Tokenized,
            bump: property_bump,
        });

        self.investment_pool.set_inner(InvestmentPool {
            property: property_key,
            vault: self.investment_vault.key(),
            total_raised: 0,
            total_withdrawn: 0,
            bump: bumps.investment_pool,
        });

        self.rent_pool.set_inner(RentPool {
            property: property_key,
            vault: self.rent_vault.key(),
            current_period: 0,
            total_deposited: 0,
            bump: bumps.rent_pool,
        });

        Ok(())
    }
}
