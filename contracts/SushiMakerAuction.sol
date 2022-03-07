// SPDX-License-Identifier: MIT

pragma solidity 0.8.11;

import "@sushiswap/core/contracts/uniswapv2/interfaces/IUniswapV2Pair.sol";
import "./utils/BoringBatchable.sol";
import "./utils/BoringOwnable.sol";

// TODO: replace with custom errors
// TODO: add events
// TODO: add unchecked to satisfy some people gas thirst
// TODO: address(0) checks?
// TODO: slot packing
// TODO: cross-check scenarios with bug/vuln list

contract SushiMakerAuction is BoringBatchable, BoringOwnable {
    struct Bid {
        address bidder;
        uint128 bid;
        uint128 amount;
        uint64 minTTL;
        uint64 maxTTL;
    }

    mapping(IERC20 => Bid) public bids;

    address public receiver;

    IERC20 public immutable bidToken;

    // keep this constant?
    uint256 public constant MIN_BID = 1000;
    uint256 public constant MIN_BID_THRESHOLD = 1e15;
    uint256 public constant MIN_BID_THRESHOLD_PRECISION = 1e18;

    // keep this configurable?
    uint64 public minTTL = 12 hours;
    uint64 public maxTTL = 3 days;

    constructor(address _receiver, IERC20 _bidToken) {
        receiver = _receiver;
        bidToken = _bidToken;
    }

    function start(
        IERC20 token,
        uint128 bidAmount,
        address to
    ) external {
        // can be combined into one
        // any better way to check LP?
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSignature("token0()")
        );

        require(success && data.length == 0, "lp token not allowed");

        require(token != bidToken, "bid token not allowed");

        require(bidAmount >= MIN_BID, "bid amount less than min");

        Bid storage bid = bids[token];

        require(bid.bidder == address(0), "bid already started");

        bidToken.transferFrom(msg.sender, address(this), bidAmount);

        bid.bidder = to;
        bid.bid = bidAmount;
        bid.amount = uint128(token.balanceOf(address(this)));
        bid.minTTL = uint64(block.timestamp) + minTTL;
        bid.maxTTL = uint64(block.timestamp) + maxTTL;
    }

    function placeBid(
        IERC20 token,
        uint128 bidAmount,
        address to
    ) external {
        Bid storage bid = bids[token];

        require(bid.bidder != address(0), "bid not started");

        require(
            bid.minTTL > block.timestamp || bid.maxTTL > block.timestamp,
            "bid finished"
        );

        require(
            (bid.bid +
                ((bid.bid * MIN_BID_THRESHOLD) /
                    MIN_BID_THRESHOLD_PRECISION)) <= bidAmount,
            "bid less than threshold"
        );

        bidToken.transferFrom(msg.sender, address(this), bidAmount);
        bidToken.transfer(bid.bidder, bid.bid);

        bid.bidder = to;
        bid.bid = bidAmount;
        bid.minTTL = uint64(block.timestamp) + minTTL;
    }

    function end(IERC20 token) external {
        Bid memory bid = bids[token];

        require(bid.bidder != address(0), "bid not started");

        require(
            bid.minTTL <= block.timestamp || bid.maxTTL <= block.timestamp,
            "Bid not Finished"
        );

        token.transfer(bid.bidder, bid.amount);

        bidToken.transfer(receiver, bid.bid);

        delete bids[token];
    }

    function unwindLP(IUniswapV2Pair lp) external {
        lp.burn(address(this));
    }

    function updateReceiver(address newReceiver) external onlyOwner {
        receiver = newReceiver;
    }

    function updateTTLs(uint64 newMinTTL, uint64 newMaxTTL) external onlyOwner {
        minTTL = newMinTTL;
        maxTTL = newMaxTTL;
    }
}
