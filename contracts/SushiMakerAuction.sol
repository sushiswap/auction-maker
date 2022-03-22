// SPDX-License-Identifier: MIT

pragma solidity 0.8.11;

import "./interfaces/ISushiMakerAuction.sol";

// TODO: add unchecked to satisfy some people gas thirst
// TODO: address(0) checks?
// TODO: slot packing
// TODO: cross-check scenarios with bug/vuln list? do we need non reentrant?
// TODO: do we need non reentrant?

// custom errors
error LPTokenNotAllowed();
error BidTokenNotAllowed();
error InsufficientBidAmount();
error BidAlreadyStarted();
error BidNotStarted();
error BidFinished();
error BidNotFinished();

contract SushiMakerAuction is
    ISushiMakerAuction,
    BoringBatchable,
    BoringOwnable,
    ReentrancyGuard
{
    uint128 public stakedBidToken;

    mapping(IERC20 => Bid) public bids;

    address public receiver;
    IERC20 public immutable bidToken;
    address public immutable factory;
    bytes32 public immutable pairCodeHash;

    uint256 private constant MIN_BID = 1000;
    uint256 private constant MIN_BID_THRESHOLD = 1e15;
    uint256 private constant MIN_BID_THRESHOLD_PRECISION = 1e18;

    uint64 private constant minTTL = 12 hours;
    uint64 private constant maxTTL = 3 days;

    modifier onlyToken(IERC20 token) {
        // Any cleaner way to find if it's a LP?
        (bool success, ) = address(token).call(
            abi.encodeWithSignature("token0()")
        );
        if (success) revert LPTokenNotAllowed();
        _;
    }

    constructor(
        address _receiver,
        IERC20 _bidToken,
        address _factory,
        bytes32 _pairCodeHash
    ) {
        receiver = _receiver;
        bidToken = _bidToken;
        factory = _factory;
        pairCodeHash = _pairCodeHash;
    }

    function start(
        IERC20 token,
        uint128 bidAmount,
        address to
    ) external override onlyToken(token) nonReentrant {
        if (token == bidToken) revert BidTokenNotAllowed();

        if (bidAmount < MIN_BID) revert InsufficientBidAmount();

        Bid storage bid = bids[token];

        if (bid.bidder != address(0)) revert BidAlreadyStarted();

        bidToken.transferFrom(msg.sender, address(this), bidAmount);

        bid.bidder = to;
        bid.bidAmount = bidAmount;
        bid.rewardAmount = uint128(token.balanceOf(address(this)));
        bid.minTTL = uint64(block.timestamp) + minTTL;
        bid.maxTTL = uint64(block.timestamp) + maxTTL;

        stakedBidToken += bidAmount;

        emit Started(token, msg.sender, bidAmount, bid.rewardAmount);
    }

    function placeBid(
        IERC20 token,
        uint128 bidAmount,
        address to
    ) external override nonReentrant {
        Bid storage bid = bids[token];

        if (bid.bidder == address(0)) revert BidNotStarted();
        if (bid.minTTL <= block.timestamp || bid.maxTTL <= block.timestamp)
            revert BidFinished();
        if (
            (bid.bidAmount +
                ((bid.bidAmount * MIN_BID_THRESHOLD) /
                    MIN_BID_THRESHOLD_PRECISION)) > bidAmount
        ) revert InsufficientBidAmount();

        stakedBidToken += bidAmount - bid.bidAmount;

        bidToken.transferFrom(msg.sender, address(this), bidAmount);
        bidToken.transfer(bid.bidder, bid.bidAmount);

        bid.bidder = to;
        bid.bidAmount = bidAmount;
        bid.minTTL = uint64(block.timestamp) + minTTL;

        emit PlacedBid(token, msg.sender, bidAmount);
    }

    function end(IERC20 token) external override nonReentrant {
        Bid memory bid = bids[token];

        if (bid.bidder == address(0)) revert BidNotStarted();

        if (bid.minTTL > block.timestamp && bid.maxTTL > block.timestamp)
            revert BidNotFinished();

        token.transfer(bid.bidder, bid.rewardAmount);

        bidToken.transfer(receiver, bid.bidAmount);

        stakedBidToken -= bid.bidAmount;

        emit Ended(token, bid.bidder, bid.bidAmount);

        delete bids[token];
    }

    function unwindLP(address token0, address token1) external override {
        IUniswapV2Pair pair = IUniswapV2Pair(
            UniswapV2Library.pairFor(factory, token0, token1, pairCodeHash)
        );
        pair.transfer(address(pair), pair.balanceOf(address(this)));
        pair.burn(address(this));
    }

    function skimBidToken() external override {
        bidToken.transfer(
            receiver,
            bidToken.balanceOf(address(this)) - stakedBidToken
        );
    }

    function updateReceiver(address newReceiver) external override onlyOwner {
        receiver = newReceiver;
    }
}
