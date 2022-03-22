// SPDX-License-Identifier: MIT

pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./libraries/UniswapV2Library.sol";
import "./utils/BoringBatchable.sol";
import "./utils/BoringOwnable.sol";

// TODO: replace with custom errors
// TODO: add events
// TODO: add unchecked to satisfy some people gas thirst
// TODO: address(0) checks?
// TODO: slot packing
// TODO: cross-check scenarios with bug/vuln list

// custom errors
error LPTokenNotAllowed();
error BidTokenNotAllowed();
error InsufficientBidAmount();
error BidAlreadyStarted();
error BidNotStarted();
error BidFinished();
error BidNotFinished();

contract SushiMakerAuction is BoringBatchable, BoringOwnable, ReentrancyGuard {
    struct Bid {
        address bidder;
        uint128 bidAmount;
        uint128 rewardAmount;
        uint64 minTTL;
        uint64 maxTTL;
    }

    uint128 public stakedBidToken;

    mapping(IERC20 => Bid) public bids;

    address public receiver;
    IERC20 public immutable bidToken;
    address public immutable factory;
    bytes32 public immutable pairCodeHash;

    // keep this constant?
    uint256 public constant MIN_BID = 1000;
    uint256 public constant MIN_BID_THRESHOLD = 1e15;
    uint256 public constant MIN_BID_THRESHOLD_PRECISION = 1e18;

    // keep this configurable?
    uint64 public minTTL = 12 hours;
    uint64 public maxTTL = 3 days;

    modifier onlyToken(IERC20 token) {

        // Any cleaner way to find if it's an LP?
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
    ) external onlyToken(token) nonReentrant {
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
    }

    function placeBid(
        IERC20 token,
        uint128 bidAmount,
        address to
    ) external nonReentrant {
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
    }

    function end(IERC20 token) external nonReentrant {
        Bid memory bid = bids[token];

        if(bid.bidder == address(0)) revert BidNotStarted();

        if(bid.minTTL > block.timestamp && bid.maxTTL > block.timestamp) revert BidNotFinished();

        token.transfer(bid.bidder, bid.rewardAmount);

        bidToken.transfer(receiver, bid.bidAmount);

        stakedBidToken -= bid.bidAmount;

        delete bids[token];
    }

    function unwindLP(address token0, address token1) external {
        IUniswapV2Pair pair = IUniswapV2Pair(
            UniswapV2Library.pairForExternal(
                factory,
                token0,
                token1,
                pairCodeHash
            )
        );
        pair.transfer(address(pair), pair.balanceOf(address(this)));
        pair.burn(address(this));
    }

    function updateReceiver(address newReceiver) external onlyOwner {
        receiver = newReceiver;
    }

    function updateTTLs(uint64 newMinTTL, uint64 newMaxTTL) external onlyOwner {
        minTTL = newMinTTL;
        maxTTL = newMaxTTL;
    }

    function sifuBidToken() external {
        bidToken.transfer(receiver, bidToken.balanceOf(address(this)));
    }
}
