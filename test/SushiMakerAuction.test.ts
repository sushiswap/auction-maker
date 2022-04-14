// @ts-nocheck

import { ethers } from "hardhat";
import { expect } from "chai";
import { BigNumber, Signer } from "ethers";
import {
  getBigNumber,
  restore,
  snapshot,
  latest,
  increase,
  MIN_TTL,
  MAX_TTL,
  ADDRESS_ZERO,
} from "./harness";

describe("Start Auction", function () {
  let accounts: Signer[];
  let tokens = [];
  let sushiToken;
  let makerAuction;
  let factory;
  let pair;
  let snapshotId;

  before(async function () {
    accounts = await ethers.getSigners();
    const ERC20 = await ethers.getContractFactory("ERC20Mock");
    const Factory = await ethers.getContractFactory("SushiSwapFactoryMock");
    const SushiSwapPairMock = await ethers.getContractFactory(
      "SushiSwapPairMock"
    );

    const MakerAuction = await ethers.getContractFactory("SushiMakerAuction");

    let promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        ERC20.deploy("Token" + i, "TOK" + i, getBigNumber(1000000))
      );
    }

    tokens = await Promise.all(promises);

    sushiToken = await ERC20.deploy("Sushi", "SUSHI", getBigNumber(1000000));

    factory = await Factory.deploy();

    const pairCodeHash = await factory.pairCodeHash();

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

    await tokens[0].transfer(pair.address, getBigNumber(100));
    await pair.swap(0, BigNumber.from(99), accounts[0].address, "0x");

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
    expect(bidData.minTTL).to.be.eq(now.add(MIN_TTL));

    // 3 days
    expect(bidData.maxTTL).to.be.eq(now.add(MAX_TTL));

    expect(stakedBidToken).to.be.eq(1000);

    expect(bidData.bidder).to.be.eq(accounts[0].address);

    expect(bidData.bidAmount).to.be.eq(1000);

    expect(bidData.rewardAmount).to.be.eq(rewardAmount);
  });
});

describe("Place Bid", function () {
  let accounts: Signer[];
  let tokens = [];
  let sushiToken;
  let makerAuction;
  let factory;
  let pair;
  let snapshotId;

  before(async function () {
    accounts = await ethers.getSigners();
    const ERC20 = await ethers.getContractFactory("ERC20Mock");
    const Factory = await ethers.getContractFactory("SushiSwapFactoryMock");
    const SushiSwapPairMock = await ethers.getContractFactory(
      "SushiSwapPairMock"
    );

    const MakerAuction = await ethers.getContractFactory("SushiMakerAuction");

    let promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        ERC20.deploy("Token" + i, "TOK" + i, getBigNumber(1000000))
      );
    }

    tokens = await Promise.all(promises);

    sushiToken = await ERC20.deploy("Sushi", "SUSHI", getBigNumber(1000000));

    factory = await Factory.deploy();

    const pairCodeHash = await factory.pairCodeHash();

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

    await tokens[0].transfer(pair.address, getBigNumber(100));
    await pair.swap(0, BigNumber.from(99), accounts[0].address, "0x");

    await tokens[0].transfer(pair.address, getBigNumber(1));
    await tokens[1].transfer(pair.address, getBigNumber(1));

    await pair.mint(accounts[0].address);

    // unwind lp
    await makerAuction.unwindLP(tokens[0].address, tokens[1].address);
    await sushiToken.transfer(accounts[1].address, getBigNumber(1));

    // start auction
    await sushiToken.approve(makerAuction.address, getBigNumber(1));
    await makerAuction.start(tokens[0].address, 1000, accounts[0].address);
  });

  beforeEach(async function () {
    snapshotId = await snapshot();
  });

  afterEach(async function () {
    await restore(snapshotId);
  });

  it("should not allow to bid if auction not started", async function () {
    await expect(
      makerAuction.placeBid(tokens[1].address, 1000, accounts[0].address)
    ).to.be.revertedWith("BidNotStarted()");
  });

  it("should not allow to bid if min ttl over", async function () {
    await increase(MIN_TTL);
    await expect(
      makerAuction.placeBid(tokens[0].address, 1001, accounts[0].address)
    ).to.be.revertedWith("BidFinished()");
  });

  it("should not allow to bid if max ttl over", async function () {
    let startAmount = 1000;
    for (let i = 0; i < 6; i++) {
      startAmount += Math.floor(startAmount * 0.001);
      await increase(MIN_TTL.sub(100));
      await makerAuction.placeBid(
        tokens[0].address,
        startAmount,
        accounts[0].address
      );
    }
    await increase(BigNumber.from(600));

    await expect(
      makerAuction.placeBid(tokens[0].address, 1010, accounts[0].address)
    ).to.be.revertedWith("BidFinished()");
  });

  it("should not allow to place less than the threshold", async function () {
    await expect(
      makerAuction.placeBid(tokens[0].address, 1000, accounts[0].address)
    ).to.be.revertedWith("InsufficientBidAmount()");
  });

  it("should allow to place bid", async function () {
    await sushiToken
      .connect(accounts[1])
      .approve(makerAuction.address, getBigNumber(1));

    const balanceSushiTokenBefore = await sushiToken.balanceOf(
      makerAuction.address
    );
    const balanceLastBidderSushiTokenBefore = await sushiToken.balanceOf(
      accounts[0].address
    );

    const beforeStakedBidToken = await makerAuction.stakedBidToken();

    await makerAuction
      .connect(accounts[1])
      .placeBid(tokens[0].address, 1001, accounts[1].address);

    const afterStakedBidToken = await makerAuction.stakedBidToken();

    const postBidData = await makerAuction.bids(tokens[0].address);

    const balanceSushiTokenAfter = await sushiToken.balanceOf(
      makerAuction.address
    );

    const balanceLastBidderSushiTokenAfter = await sushiToken.balanceOf(
      accounts[0].address
    );
    expect(balanceSushiTokenAfter).to.be.eq(balanceSushiTokenBefore.add(1));
    expect(balanceLastBidderSushiTokenAfter).to.be.eq(
      balanceLastBidderSushiTokenBefore.add(1000)
    );
    expect(postBidData.bidder).to.be.eq(accounts[1].address);
    expect(postBidData.bidAmount).to.be.eq(1001);
    expect(afterStakedBidToken).to.be.eq(beforeStakedBidToken.add(1));
  });
});

describe("End Auction", function () {
  let accounts: Signer[];
  let tokens = [];
  let sushiToken;
  let makerAuction;
  let factory;
  let pair;
  let snapshotId;

  before(async function () {
    accounts = await ethers.getSigners();
    const ERC20 = await ethers.getContractFactory("ERC20Mock");
    const Factory = await ethers.getContractFactory("SushiSwapFactoryMock");
    const SushiSwapPairMock = await ethers.getContractFactory(
      "SushiSwapPairMock"
    );

    const MakerAuction = await ethers.getContractFactory("SushiMakerAuction");

    let promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        ERC20.deploy("Token" + i, "TOK" + i, getBigNumber(1000000))
      );
    }

    tokens = await Promise.all(promises);

    sushiToken = await ERC20.deploy("Sushi", "SUSHI", getBigNumber(1000000));

    factory = await Factory.deploy();

    const pairCodeHash = await factory.pairCodeHash();

    makerAuction = await MakerAuction.deploy(
      accounts[5].address,
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

    await tokens[0].transfer(pair.address, getBigNumber(100));
    await pair.swap(0, BigNumber.from(99), accounts[0].address, "0x");

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

  it("should not allow to end if auction not started", async function () {
    await expect(makerAuction.end(tokens[0].address)).to.be.revertedWith(
      "BidNotStarted()"
    );
  });

  it("should not allow to end bid if min ttl not over", async function () {
    // start auction
    await sushiToken.approve(makerAuction.address, getBigNumber(1));
    await makerAuction.start(tokens[0].address, 1000, accounts[0].address);

    await expect(makerAuction.end(tokens[0].address)).to.be.revertedWith(
      "BidNotFinished()"
    );
  });

  it("should not allow to end bid before max ttl not over", async function () {
    await sushiToken.approve(makerAuction.address, getBigNumber(1));
    await makerAuction.start(tokens[0].address, 1000, accounts[0].address);

    let startAmount = 1000;
    for (let i = 0; i < 6; i++) {
      startAmount += Math.floor(startAmount * 0.001);
      await increase(MIN_TTL.sub(100));
      await makerAuction.placeBid(
        tokens[0].address,
        startAmount,
        accounts[0].address
      );
    }
    await expect(makerAuction.end(tokens[0].address)).to.be.revertedWith(
      "BidNotFinished()"
    );
  });

  it("should allow to end auction and start new auction", async function () {
    await sushiToken.approve(makerAuction.address, getBigNumber(1));
    await makerAuction.start(tokens[0].address, 1000, accounts[0].address);

    const beforeStakedBidToken = await makerAuction.stakedBidToken();

    await increase(MIN_TTL.add(1));

    await makerAuction.end(tokens[0].address);

    const afterStakedBidToken = await makerAuction.stakedBidToken();

    const postBidData = await makerAuction.bids(tokens[0].address);

    const receiverSushiBalance = await sushiToken.balanceOf(
      accounts[5].address
    );

    expect(receiverSushiBalance).to.be.eq(1000);
    expect(postBidData.bidder).to.be.eq(ADDRESS_ZERO);
    expect(afterStakedBidToken).to.be.eq(beforeStakedBidToken.sub(1000));
    await makerAuction.start(tokens[0].address, 1000, accounts[0].address);
  });
});

describe("Skim Tokens and Update Receiver", function () {
  let accounts: Signer[];
  let tokens = [];
  let sushiToken;
  let makerAuction;
  let factory;
  let snapshotId;

  before(async function () {
    accounts = await ethers.getSigners();
    const ERC20 = await ethers.getContractFactory("ERC20Mock");
    const Factory = await ethers.getContractFactory("SushiSwapFactoryMock");

    const MakerAuction = await ethers.getContractFactory("SushiMakerAuction");

    let promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        ERC20.deploy("Token" + i, "TOK" + i, getBigNumber(1000000))
      );
    }

    tokens = await Promise.all(promises);

    sushiToken = await ERC20.deploy("Sushi", "SUSHI", getBigNumber(1000000));

    factory = await Factory.deploy();

    const pairCodeHash = await factory.pairCodeHash();

    makerAuction = await MakerAuction.deploy(
      accounts[5].address,
      sushiToken.address,
      factory.address,
      pairCodeHash
    );
  });

  beforeEach(async function () {
    snapshotId = await snapshot();
  });

  afterEach(async function () {
    await restore(snapshotId);
  });

  it("should skim bid token", async function () {
    await sushiToken.approve(makerAuction.address, getBigNumber(1));
    await makerAuction.start(tokens[0].address, 1000, accounts[0].address);

    const balanceReceiverPreSkim1 = await sushiToken.balanceOf(
      accounts[5].address
    );
    await makerAuction.skimBidToken();
    const balanceReceiverPostSkim1 = await sushiToken.balanceOf(
      accounts[5].address
    );
    expect(balanceReceiverPostSkim1).to.be.eq(balanceReceiverPreSkim1);

    const balanceReceiverPreSkim2 = await sushiToken.balanceOf(
      accounts[5].address
    );
    await sushiToken.transfer(accounts[5].address, 1000);
    await makerAuction.skimBidToken();
    const balanceReceiverPostSkim2 = await sushiToken.balanceOf(
      accounts[5].address
    );
    expect(balanceReceiverPostSkim2).to.be.eq(
      balanceReceiverPreSkim2.add(1000)
    );
  });

  it("should not update receiver when not owner", async function () {
    await expect(
      makerAuction.connect(accounts[1]).updateReceiver(accounts[1].address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should update the receiver when owner", async function () {
    await makerAuction.connect(accounts[0]).updateReceiver(accounts[1].address);
  });

  it("should allow to whitelist tokens", async function () {
    await sushiToken.approve(makerAuction.address, getBigNumber(1));

    await makerAuction
      .connect(accounts[0])
      .updateWhitelistToken(tokens[1].address, true);
    await makerAuction.start(tokens[1].address, 1000, accounts[0].address);
  });
});
