import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ExtensionType,
  createMint,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  getMintLen,
  getTransferHook,
  getExtraAccountMetas,
} from "@solana/spl-token";
import { expect } from "chai";
import { PropertyVault } from "../target/types/property_vault";
import { PropertyVaultTransferHook } from "../target/types/property_vault_transfer_hook";
import {
  confirmedProvider,
  defaultArgs,
  derivePdas,
  listAccounts,
  expectFailure,
  toBig,
} from "./utils";

describe("transfer hook: recipient whitelist", () => {
  const provider = confirmedProvider();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const hook = anchor.workspace
    .PropertyVaultTransferHook as Program<PropertyVaultTransferHook>;
  const main = anchor.workspace.PropertyVault as Program<PropertyVault>;
  const admin = provider.wallet as anchor.Wallet;

  const DECIMALS = 0;
  const SENDER_BALANCE = 1000;

  const mint = Keypair.generate();
  const sender = Keypair.generate();
  const allowed = Keypair.generate();
  const blocked = Keypair.generate();
  const attacker = Keypair.generate();

  const ata = (owner: PublicKey) =>
    getAssociatedTokenAddressSync(
      mint.publicKey,
      owner,
      true,
      TOKEN_2022_PROGRAM_ID
    );
  const senderAta = ata(sender.publicKey);
  const allowedAta = ata(allowed.publicKey);
  const blockedAta = ata(blocked.publicKey);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    hook.programId
  );
  const whitelistPda = (user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist"), user.toBuffer()],
      hook.programId
    )[0];
  const extraMetasPda = (forMint: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), forMint.toBuffer()],
      hook.programId
    )[0];

  const addToWhitelist = (user: PublicKey) =>
    hook.methods
      .addToWhitelist(user)
      .accountsStrict({
        admin: admin.publicKey,
        config: configPda,
        whitelist: whitelistPda(user),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

  const removeFromWhitelist = (user: PublicKey) =>
    hook.methods
      .removeFromWhitelist(user)
      .accountsStrict({
        admin: admin.publicKey,
        config: configPda,
        whitelist: whitelistPda(user),
      })
      .rpc();

  async function balance(address: PublicKey): Promise<number> {
    const account = await getAccount(
      connection,
      address,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    return Number(account.amount);
  }

  async function transfer(
    from: Keypair,
    fromAta: PublicKey,
    toAta: PublicKey,
    amount: number
  ) {
    const ix = await createTransferCheckedWithTransferHookInstruction(
      connection,
      fromAta,
      mint.publicKey,
      toAta,
      from.publicKey,
      toBig(amount),
      DECIMALS,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    return provider.sendAndConfirm(new Transaction().add(ix), [from]);
  }

  before(async () => {
    if (!(await connection.getAccountInfo(configPda))) {
      await hook.methods
        .initialize()
        .accountsStrict({
          admin: admin.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const mintLen = getMintLen([ExtensionType.TransferHook]);
    const lamports = await connection.getMinimumBalanceForRentExemption(
      mintLen
    );
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: mint.publicKey,
          space: mintLen,
          lamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeTransferHookInstruction(
          mint.publicKey,
          admin.publicKey,
          hook.programId,
          TOKEN_2022_PROGRAM_ID
        ),
        createInitializeMintInstruction(
          mint.publicKey,
          DECIMALS,
          admin.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        )
      ),
      [mint]
    );

    await hook.methods
      .initializeExtraAccountMetaList()
      .accountsStrict({
        payer: admin.publicKey,
        extraAccountMetaList: extraMetasPda(mint.publicKey),
        mint: mint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: attacker.publicKey,
          lamports: 1_000_000_000,
        })
      )
    );

    const owners: Array<[PublicKey, PublicKey]> = [
      [sender.publicKey, senderAta],
      [allowed.publicKey, allowedAta],
      [blocked.publicKey, blockedAta],
    ];
    const tx = new Transaction();
    for (const [owner, address] of owners) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          admin.publicKey,
          address,
          owner,
          mint.publicKey,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }
    tx.add(
      createMintToInstruction(
        mint.publicKey,
        senderAta,
        admin.publicKey,
        SENDER_BALANCE,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(tx);
  });

  describe("whitelist administration", () => {
    it("stores the admin in the config", async () => {
      const config = await hook.account.config.fetch(configPda);
      expect(config.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    });

    it("rejects a second initialization of the config", async () => {
      await expectFailure(
        hook.methods
          .initialize()
          .accountsStrict({
            admin: admin.publicKey,
            config: configPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc()
      );
    });

    it("lets only the admin add to the whitelist", async () => {
      const candidate = Keypair.generate().publicKey;

      await expectFailure(
        hook.methods
          .addToWhitelist(candidate)
          .accountsStrict({
            admin: attacker.publicKey,
            config: configPda,
            whitelist: whitelistPda(candidate),
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc(),
        "InvalidAdmin"
      );
      expect(await connection.getAccountInfo(whitelistPda(candidate))).to.equal(
        null
      );

      await addToWhitelist(candidate);
      const entry = await hook.account.whitelist.fetch(whitelistPda(candidate));
      expect(entry.address.toBase58()).to.equal(candidate.toBase58());
    });

    it("rejects adding the same address twice", async () => {
      const user = Keypair.generate().publicKey;
      await addToWhitelist(user);
      await expectFailure(addToWhitelist(user));
    });

    it("lets only the admin remove from the whitelist", async () => {
      const user = Keypair.generate().publicKey;
      await addToWhitelist(user);

      await expectFailure(
        hook.methods
          .removeFromWhitelist(user)
          .accountsStrict({
            admin: attacker.publicKey,
            config: configPda,
            whitelist: whitelistPda(user),
          })
          .signers([attacker])
          .rpc(),
        "InvalidAdmin"
      );
      expect(await connection.getAccountInfo(whitelistPda(user))).to.not.equal(
        null
      );

      await removeFromWhitelist(user);
      expect(await connection.getAccountInfo(whitelistPda(user))).to.equal(
        null
      );
    });
  });

  describe("ExtraAccountMetaList", () => {
    it("exists, is owned by the hook program and lists only the recipient whitelist", async () => {
      const info = await connection.getAccountInfo(
        extraMetasPda(mint.publicKey)
      );
      expect(info, "extra account meta list").to.not.equal(null);
      expect(info!.owner.toBase58()).to.equal(hook.programId.toBase58());
      expect(getExtraAccountMetas(info!).length).to.equal(1);
    });

    it("cannot be initialized twice for the same mint", async () => {
      await expectFailure(
        hook.methods
          .initializeExtraAccountMetaList()
          .accountsStrict({
            payer: admin.publicKey,
            extraAccountMetaList: extraMetasPda(mint.publicKey),
            mint: mint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc()
      );
    });
  });

  describe("transfer enforcement", () => {
    it("blocks a transfer to a recipient that is not whitelisted", async () => {
      await expectFailure(
        transfer(sender, senderAta, allowedAta, 10),
        "NotWhitelisted"
      );

      expect(await balance(senderAta)).to.equal(SENDER_BALANCE);
      expect(await balance(allowedAta)).to.equal(0);
    });

    it("allows a transfer to a whitelisted recipient (sender need not be whitelisted)", async () => {
      await addToWhitelist(allowed.publicKey);
      expect(
        await connection.getAccountInfo(whitelistPda(sender.publicKey))
      ).to.equal(null);

      await transfer(sender, senderAta, allowedAta, 100);

      expect(await balance(senderAta)).to.equal(SENDER_BALANCE - 100);
      expect(await balance(allowedAta)).to.equal(100);
    });

    it("still blocks other recipients that are not whitelisted", async () => {
      await expectFailure(
        transfer(sender, senderAta, blockedAta, 10),
        "NotWhitelisted"
      );

      expect(await balance(senderAta)).to.equal(SENDER_BALANCE - 100);
      expect(await balance(blockedAta)).to.equal(0);
    });

    it("does not let a whitelisted sender send to a non-whitelisted recipient", async () => {
      await addToWhitelist(sender.publicKey);

      await expectFailure(
        transfer(sender, senderAta, blockedAta, 10),
        "NotWhitelisted"
      );
      expect(await balance(blockedAta)).to.equal(0);
    });

    it("allows transfers back to a recipient that became whitelisted", async () => {
      await transfer(allowed, allowedAta, senderAta, 20);

      expect(await balance(allowedAta)).to.equal(80);
      expect(await balance(senderAta)).to.equal(SENDER_BALANCE - 100 + 20);
    });

    it("blocks transfers again after the recipient is removed from the whitelist", async () => {
      await removeFromWhitelist(allowed.publicKey);

      await expectFailure(
        transfer(sender, senderAta, allowedAta, 10),
        "NotWhitelisted"
      );
      expect(await balance(allowedAta)).to.equal(80);
    });

    it("allows transfers again after the recipient is re-added", async () => {
      await addToWhitelist(allowed.publicKey);

      await transfer(sender, senderAta, allowedAta, 5);
      expect(await balance(allowedAta)).to.equal(85);
    });

    it("rejects a direct call of transfer_hook outside a token transfer", async () => {
      await expectFailure(
        hook.methods
          .transferHook(new BN(1))
          .accountsStrict({
            sourceTokenAta: senderAta,
            mint: mint.publicKey,
            destinationTokenAta: allowedAta,
            owner: sender.publicKey,
            extraAccountMetaList: extraMetasPda(mint.publicKey),
            destinationWhitelist: whitelistPda(allowed.publicKey),
          })
          .rpc(),
        "NotTransferring"
      );
    });
  });

  describe("property mint created by list_and_tokenize_property", () => {
    it("is wired to this hook and accepts its ExtraAccountMetaList", async () => {
      const paymentMint = await createMint(
        connection,
        (admin as any).payer,
        admin.publicKey,
        null,
        6,
        undefined,
        { commitment: "confirmed" },
        TOKEN_PROGRAM_ID
      );
      const args = defaultArgs(100);
      const pdas = derivePdas(main.programId, admin.publicKey, args.propertyId);

      await main.methods
        .listAndTokenizeProperty(args)
        .accountsStrict(
          listAccounts(pdas, admin.publicKey, paymentMint, hook.programId)
        )
        .rpc();

      const mintInfo = await getMint(
        connection,
        pdas.mintPda,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      const extension = getTransferHook(mintInfo);
      expect(extension, "TransferHook extension").to.not.equal(null);
      expect(extension!.programId.toBase58()).to.equal(
        hook.programId.toBase58()
      );

      const metasAddress = extraMetasPda(pdas.mintPda);
      await hook.methods
        .initializeExtraAccountMetaList()
        .accountsStrict({
          payer: admin.publicKey,
          extraAccountMetaList: metasAddress,
          mint: pdas.mintPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const info = await connection.getAccountInfo(metasAddress);
      expect(info, "extra account meta list").to.not.equal(null);
      expect(info!.owner.toBase58()).to.equal(hook.programId.toBase58());
      expect(getExtraAccountMetas(info!).length).to.equal(1);
    });
  });
});
