use anchor_lang::prelude::*;

#[error_code]
pub enum PropertyVaultTransferHookError {
    #[msg("Invalid admin")]
    InvalidAdmin,

    #[msg("Extra Account Meta Error")]
    ExtraAccountMetaError,

    #[msg("Not Transferring")]
    NotTransferring,

    #[msg("Recipient is not whitelisted")]
    NotWhitelisted,
}
