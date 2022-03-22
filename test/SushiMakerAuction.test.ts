// @ts-nocheck

import { ethers } from "hardhat";
import { expect } from "chai";
import { BigNumber, Signer } from "ethers";
import { getBigNumber, restore, snapshot, latest } from "./harness";

describe("Start Auction", function () {
  let accounts: Signer[];
  let tokens = [];
  let sushiToken;
  let nativeToken;
  let makerAuction;
  let factory;
  let pair;
  let router;
  let snapshotId;

  before(async function () {
    accounts = await ethers.getSigners();
    const ERC20 = await ethers.getContractFactory("ERC20Mock");
    const Factory = await ethers.getContractFactory("SushiSwapFactoryMock");
    const SushiSwapPairMock = await ethers.getContractFactory(
      "SushiSwapPairMock"
    );

    const Router = await ethers.getContractFactory("UniswapV2Router02");

    const MakerAuction = await ethers.getContractFactory("SushiMakerAuction");

    let promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        ERC20.deploy("Token" + i, "TOK" + i, getBigNumber(1000000))
      );
    }

    tokens = await Promise.all(promises);

    sushiToken = await ERC20.deploy("Sushi", "SUSHI", getBigNumber(1000000));

    nativeToken = await ERC20.deploy(
      "NativeToken",
      "NTK",
      getBigNumber(1000000)
    );

    factory = await Factory.deploy();

    const pairCodeHash = await factory.pairCodeHash();

    router = await Router.deploy(factory.address, nativeToken.address);

    makerAuction = await MakerAuction.deploy(
      accounts[0].address,
      sushiToken.address,
      factory.address,
      pairCodeHash
    );

    await factory.setFeeTo(makerAuction.address);

    const createPairTx = await factory.createPair(
      tokens[0].address,
      tokens[1].address
    );

    const _pair = (await createPairTx.wait()).events[0].args.pair;

    pair = await SushiSwapPairMock.attach(_pair);

    // mint liq
    await tokens[0].transfer(pair.address, getBigNumber(500000));
    await tokens[1].transfer(pair.address, getBigNumber(500000));

    await pair.mint(accounts[0].address);

    await tokens[0].approve(router.address, getBigNumber(1000000));
    await tokens[1].approve(router.address, getBigNumber(1000000));

    // swap and mint fee
    const amountOut = await router.getAmountsOut(getBigNumber(100), [
      tokens[0].address,
      tokens[1].address,
    ]);

    await router.swapExactTokensForTokens(
      getBigNumber(100),
      amountOut[1],
      [tokens[0].address, tokens[1].address],
      accounts[0].address,
      ~~(Date.now() / 1000 + 3600)
    );

    await tokens[0].transfer(pair.address, getBigNumber(1));
    await tokens[1].transfer(pair.address, getBigNumber(1));

    await pair.mint(accounts[0].address);

    // unwind lp
    await makerAuction.unwindLP(tokens[0].address, tokens[1].address);
  });

  beforeEach(async function () {
    snapshotId = await snapshot();
  });

  afterEach(async function () {
    await restore(snapshotId);
  });

  it("should not allow to auction LP Token", async function () {
    await expect(
      makerAuction.start(pair.address, 1000, accounts[0].address)
    ).to.be.revertedWith("LPTokenNotAllowed()");
  });

  it("should not allow to auction bid token", async function () {
    await expect(
      makerAuction.start(sushiToken.address, 1000, accounts[0].address)
    ).to.be.revertedWith("BidTokenNotAllowed()");
  });

  it("should not allow to less amount than bid min", async function () {
    await expect(
      makerAuction.start(tokens[0].address, 999, accounts[0].address)
    ).to.be.revertedWith("InsufficientBidAmount()");
  });

  it("should not allow to start bid if already running", async function () {
    await sushiToken.approve(makerAuction.address, getBigNumber(1));
    await makerAuction.start(tokens[0].address, 1000, accounts[0].address);
    await expect(
      makerAuction.start(tokens[0].address, 1000, accounts[0].address)
    ).to.be.revertedWith("BidAlreadyStarted()");
  });

  it("should start auction", async function () {
    const rewardAmount = await tokens[0].balanceOf(makerAuction.address);
    await sushiToken.approve(makerAuction.address, getBigNumber(1));

    await makerAuction.start(tokens[0].address, 1000, accounts[0].address);

    const stakedBidToken = await makerAuction.stakedBidToken();

    const bidData = await makerAuction.bids(tokens[0].address);

    const now = await latest();

    // 12 hours
    expect(bidData.minTTL).to.be.eq(now.add(BigNumber.from(43200)));

    // 3 days
    expect(bidData.maxTTL).to.be.eq(now.add(259200));

    expect(stakedBidToken).to.be.eq(1000);

    expect(bidData.bidder).to.be.eq(accounts[0].address);

    expect(bidData.bidAmount).to.be.eq(1000);

    expect(bidData.rewardAmount).to.be.eq(rewardAmount);
  });
});

// it("should start the auction for token", async function () {
//   await sushiToken.approve(makerAuction.address, getBigNumber(10000000));
//   await makerAuction.unwindLP(tokens[0].address, tokens[1].address);

//   await makerAuction.start(tokens[0].address, 1000, accounts[0].address);

//   console.log(await makerAuction.bids(tokens[0].address));

//   await makerAuction.placeBid(tokens[0].address, 1001, accounts[0].address);
// });
