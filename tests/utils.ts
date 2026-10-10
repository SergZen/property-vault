import { AnchorProvider } from "@anchor-lang/core";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

declare const BigInt: (n: number) => any;

export function confirmedProvider(): AnchorProvider {
  const base = AnchorProvider.env();
  return new AnchorProvider(
    new Connection(base.connection.rpcEndpoint, "confirmed"),
    base.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
}

export function toBig(n: number): any {
  return BigInt(n);
}

export interface ListArgs {
  propertyId: BN;
  valuation: BN;
  tokenSupply: BN;
  tokenPrice: BN;
  monthlyRent: BN;
  termsVersion: number;
  termsHash: number[];
}

export function defaultArgs(
  propertyId: number,
  overrides: Partial<ListArgs> = {}
): ListArgs {
  return {
    propertyId: new BN(propertyId),
    valuation: new BN(500000_000000),
    tokenSupply: new BN(10000),
    tokenPrice: new BN(50_000000),
    monthlyRent: new BN(2500_000000),
    termsVersion: 1,
    termsHash: Array.from(Buffer.alloc(32, 7)),
    ...overrides,
  };
}

export function derivePdas(
  programId: PublicKey,
  owner: PublicKey,
  propertyId: BN
) {
  const idBytes = propertyId.toArrayLike(Buffer, "le", 8);

  const [propertyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("property"), owner.toBuffer(), idBytes],
    programId
  );
  const [mintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("property_mint"), propertyPda.toBuffer()],
    programId
  );
  const [inventoryPda] = PublicKey.findProgramAddressSync(
    [
      propertyPda.toBuffer(),
      TOKEN_2022_PROGRAM_ID.toBuffer(),
      mintPda.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [investmentPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("investment_pool"), propertyPda.toBuffer()],
    programId
  );
  const [rentPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rent_pool"), propertyPda.toBuffer()],
    programId
  );
  const [investmentVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("investment_vault"), propertyPda.toBuffer()],
    programId
  );
  const [rentVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rent_vault"), propertyPda.toBuffer()],
    programId
  );

  return {
    propertyPda,
    mintPda,
    inventoryPda,
    investmentPoolPda,
    rentPoolPda,
    investmentVaultPda,
    rentVaultPda,
  };
}

export function listAccounts(
  pdas: ReturnType<typeof derivePdas>,
  owner: PublicKey,
  paymentMint: PublicKey,
  hookProgram: PublicKey,
  overrides: Record<string, PublicKey> = {}
) {
  return {
    owner,
    property: pdas.propertyPda,
    mint: pdas.mintPda,
    inventory: pdas.inventoryPda,
    hookProgram,
    paymentMint,
    investmentPool: pdas.investmentPoolPda,
    rentPool: pdas.rentPoolPda,
    investmentVault: pdas.investmentVaultPda,
    rentVault: pdas.rentVaultPda,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    paymentTokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    ...overrides,
  };
}

export function errText(err: any): string {
  const parts: string[] = [String(err)];
  if (err && err.message) parts.push(String(err.message));
  if (err && err.error && err.error.errorCode) {
    parts.push(String(err.error.errorCode.code));
  }
  if (err && Array.isArray(err.logs)) parts.push(err.logs.join("\n"));
  if (err && Array.isArray(err.transactionLogs)) {
    parts.push(err.transactionLogs.join("\n"));
  }
  return parts.join("\n");
}

export async function expectFailure(
  promise: Promise<unknown>,
  fragment?: string
): Promise<string> {
  let text: string | null = null;
  try {
    await promise;
  } catch (e) {
    text = errText(e);
  }
  if (text === null) {
    throw new Error("Expected the transaction to fail, but it succeeded");
  }
  if (fragment) {
    expect(text).to.include(fragment);
  }
  return text;
}
