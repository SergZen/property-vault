import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getMint,
  getTransferHook,
} from "@solana/spl-token";
import { expect } from "chai";
import { PropertyVault } from "../target/types/property_vault";
import {
  ListArgs,
  confirmedProvider,
  defaultArgs,
  derivePdas,
  listAccounts,
  expectFailure,
} from "./utils";

describe("list_and_tokenize_property", () => {
  const provider = confirmedProvider();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.PropertyVault as Program<PropertyVault>;
  const owner = provider.wallet as anchor.Wallet;

  const hookProgram = anchor.workspace.PropertyVaultTransferHook;
  const HOOK_PROGRAM_ID: PublicKey = hookProgram.programId;

  let paymentMint: PublicKey;

  const pdasFor = (propertyId: BN, who: PublicKey = owner.publicKey) =>
    derivePdas(program.programId, who, propertyId);

  const accountsFor = (
    pdas: ReturnType<typeof pdasFor>,
    overrides: Record<string, PublicKey> = {},
    who: PublicKey = owner.publicKey
  ) => listAccounts(pdas, who, paymentMint, HOOK_PROGRAM_ID, overrides);

  const list = (args: ListArgs, overrides: Record<string, PublicKey> = {}) =>
    program.methods
      .listAndTokenizeProperty(args)
      .accountsStrict(accountsFor(pdasFor(args.propertyId), overrides))
      .rpc();

  async function expectNoState(pdas: ReturnType<typeof pdasFor>) {
    const all = [
      pdas.propertyPda,
      pdas.mintPda,
      pdas.inventoryPda,
      pdas.investmentPoolPda,
      pdas.rentPoolPda,
      pdas.investmentVaultPda,
      pdas.rentVaultPda,
    ];
    for (const address of all) {
      expect(
        await connection.getAccountInfo(address),
        address.toBase58()
      ).to.equal(null);
    }
  }

  before(async () => {
    paymentMint = await createMint(
      connection,
      (owner as any).payer,
      owner.publicKey,
      null,
      6,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );
  });

  describe("happy path", () => {
    const args = defaultArgs(1);
    const pdas = pdasFor(args.propertyId);

    before(async () => {
      await list(args);
    });

    it("stores property configuration and links", async () => {
      const property = await program.account.property.fetch(pdas.propertyPda);

      expect(property.owner.toBase58()).to.equal(owner.publicKey.toBase58());
      expect(property.propertyId.toString()).to.equal(
        args.propertyId.toString()
      );
      expect(property.valuation.toString()).to.equal(args.valuation.toString());
      expect(property.tokenSupply.toString()).to.equal(
        args.tokenSupply.toString()
      );
      expect(property.tokenPrice.toString()).to.equal(
        args.tokenPrice.toString()
      );
      expect(property.monthlyRent.toString()).to.equal(
        args.monthlyRent.toString()
      );
      expect(property.termsVersion).to.equal(args.termsVersion);
      expect(Buffer.from(property.termsHash)).to.deep.equal(
        Buffer.from(args.termsHash)
      );
      expect(property.tokensSold.toNumber()).to.equal(0);
      expect(property.mint.toBase58()).to.equal(pdas.mintPda.toBase58());
      expect(property.paymentMint.toBase58()).to.equal(paymentMint.toBase58());
      expect(property.investmentPool.toBase58()).to.equal(
        pdas.investmentPoolPda.toBase58()
      );
      expect(property.rentPool.toBase58()).to.equal(
        pdas.rentPoolPda.toBase58()
      );
      expect(property.inventory.toBase58()).to.equal(
        pdas.inventoryPda.toBase58()
      );
      expect(property.status).to.have.property("tokenized");
    });

    it("creates a Token-2022 mint wired to the transfer hook", async () => {
      const mintInfo = await getMint(
        connection,
        pdas.mintPda,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

      expect(mintInfo.decimals).to.equal(0);
      expect(mintInfo.supply.toString()).to.equal(args.tokenSupply.toString());
      expect(
        mintInfo.mintAuthority && mintInfo.mintAuthority.toBase58()
      ).to.equal(pdas.propertyPda.toBase58());
      expect(mintInfo.freezeAuthority).to.equal(null);

      const hook = getTransferHook(mintInfo);
      expect(hook, "TransferHook extension").to.not.equal(null);
      expect(hook!.programId.toBase58()).to.equal(HOOK_PROGRAM_ID.toBase58());
      expect(hook!.authority.toBase58()).to.equal(pdas.propertyPda.toBase58());
    });

    it("mints the whole supply into the inventory owned by the property PDA", async () => {
      const inventory = await getAccount(
        connection,
        pdas.inventoryPda,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      expect(inventory.amount.toString()).to.equal(args.tokenSupply.toString());
      expect(inventory.owner.toBase58()).to.equal(pdas.propertyPda.toBase58());
      expect(inventory.mint.toBase58()).to.equal(pdas.mintPda.toBase58());
    });

    it("initializes both pools", async () => {
      const investmentPool = await program.account.investmentPool.fetch(
        pdas.investmentPoolPda
      );
      expect(investmentPool.property.toBase58()).to.equal(
        pdas.propertyPda.toBase58()
      );
      expect(investmentPool.vault.toBase58()).to.equal(
        pdas.investmentVaultPda.toBase58()
      );
      expect(investmentPool.totalRaised.toNumber()).to.equal(0);
      expect(investmentPool.totalWithdrawn.toNumber()).to.equal(0);

      const rentPool = await program.account.rentPool.fetch(pdas.rentPoolPda);
      expect(rentPool.property.toBase58()).to.equal(
        pdas.propertyPda.toBase58()
      );
      expect(rentPool.vault.toBase58()).to.equal(pdas.rentVaultPda.toBase58());
      expect(rentPool.currentPeriod.toNumber()).to.equal(0);
      expect(rentPool.totalDeposited.toNumber()).to.equal(0);
    });

    it("creates separate mock USDC vaults controlled by the pool PDAs", async () => {
      const investmentVault = await getAccount(
        connection,
        pdas.investmentVaultPda,
        "confirmed",
        TOKEN_PROGRAM_ID
      );
      const rentVault = await getAccount(
        connection,
        pdas.rentVaultPda,
        "confirmed",
        TOKEN_PROGRAM_ID
      );

      expect(pdas.investmentVaultPda.toBase58()).to.not.equal(
        pdas.rentVaultPda.toBase58()
      );
      expect(investmentVault.mint.toBase58()).to.equal(paymentMint.toBase58());
      expect(investmentVault.owner.toBase58()).to.equal(
        pdas.investmentPoolPda.toBase58()
      );
      expect(investmentVault.amount.toString()).to.equal("0");
      expect(rentVault.mint.toBase58()).to.equal(paymentMint.toBase58());
      expect(rentVault.owner.toBase58()).to.equal(pdas.rentPoolPda.toBase58());
      expect(rentVault.amount.toString()).to.equal("0");
    });

    it("rejects a duplicate property and leaves the original untouched", async () => {
      const duplicate = defaultArgs(1, {
        valuation: new BN(1),
        tokenSupply: new BN(5),
      });
      await expectFailure(list(duplicate));

      const property = await program.account.property.fetch(pdas.propertyPda);
      expect(property.valuation.toString()).to.equal(args.valuation.toString());
      expect(property.tokenSupply.toString()).to.equal(
        args.tokenSupply.toString()
      );

      const inventory = await getAccount(
        connection,
        pdas.inventoryPda,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      expect(inventory.amount.toString()).to.equal(args.tokenSupply.toString());
    });

    it("allows the same owner to list a different property_id", async () => {
      const second = defaultArgs(2);
      await list(second);
      const property = await program.account.property.fetch(
        pdasFor(second.propertyId).propertyPda
      );
      expect(property.propertyId.toNumber()).to.equal(2);
    });
  });

  describe("validation and error handling", () => {
    const invalidCases: Array<[string, number, Partial<ListArgs>]> = [
      ["valuation is 0", 10, { valuation: new BN(0) }],
      ["token supply is 0", 11, { tokenSupply: new BN(0) }],
      ["token price is 0", 12, { tokenPrice: new BN(0) }],
      ["monthly rent is 0", 13, { monthlyRent: new BN(0) }],
    ];

    for (const [name, id, override] of invalidCases) {
      it(
        "fails with InvalidConfig when " + name + " and creates no state",
        async () => {
          const args = defaultArgs(id, override);
          await expectFailure(list(args), "InvalidConfig");
          await expectNoState(pdasFor(args.propertyId));
        }
      );
    }

    it("fails when an unknown hook program is passed", async () => {
      const args = defaultArgs(20);
      const fakeHookProgram = Keypair.generate().publicKey;
      await expectFailure(
        list(args, { hookProgram: fakeHookProgram }),
        "ConstraintAddress"
      );
      await expectNoState(pdasFor(args.propertyId));
    });

    it("fails when the payment token program does not own the payment mint", async () => {
      const args = defaultArgs(21);
      await expectFailure(
        list(args, { paymentTokenProgram: TOKEN_2022_PROGRAM_ID })
      );
      await expectNoState(pdasFor(args.propertyId));
    });

    it("fails when the owner does not sign", async () => {
      const args = defaultArgs(22);
      const stranger = Keypair.generate();
      const pdas = pdasFor(args.propertyId, stranger.publicKey);

      const tx = await program.methods
        .listAndTokenizeProperty(args)
        .accountsStrict(accountsFor(pdas, {}, stranger.publicKey))
        .transaction();

      await expectFailure(provider.sendAndConfirm(tx));
      await expectNoState(pdas);
    });
  });
});
