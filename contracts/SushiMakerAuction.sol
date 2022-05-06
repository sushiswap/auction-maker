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
    using SafeERC20 for IERC20;
    uint128 public stakedBidToken;

    mapping(IERC20 => Bid) public bids;
    mapping(IERC20 => bool) public whitelistedTokens;
    mapping(address => mapping(IERC20 => uint256)) balances;

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
        if (!whitelistedTokens[token]) {
            (bool success, bytes memory result) = address(token).call(
                abi.encodeWithSignature("token0()")
            );
            if (success && result.length == 32) revert LPTokenNotAllowed();
        }
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

    function deposit(IERC20 token, uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender][token] += amount;
        if (token == bidToken) {
            stakedBidToken += uint128(amount);
        }
    }

    function withdraw(IERC20 token, uint256 amount) external {
        balances[msg.sender][token] -= amount;
        if (token == bidToken) {
            stakedBidToken -= uint128(amount);
        }
        token.safeTransfer(msg.sender, amount);
    }

    function _updateTokenBalance(
        IERC20 token,
        address to,
        uint256 amount,
        bool inc
    ) internal {
        if (inc) {
            balances[to][token] += amount;
        } else {
            balances[to][token] -= amount;
        }
    }

    function getBalance(address user, IERC20 token)
        external
        view
        returns (uint256 balance)
    {
        return balances[user][token];
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

        _updateTokenBalance(bidToken, msg.sender, bidAmount, false);

        bid.bidder = to;
        bid.bidAmount = bidAmount;
        bid.rewardAmount = uint128(token.balanceOf(address(this)));
        bid.minTTL = uint64(block.timestamp) + minTTL;
        bid.maxTTL = uint64(block.timestamp) + maxTTL;

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

        _updateTokenBalance(bidToken, msg.sender, bidAmount, false);
        _updateTokenBalance(bidToken, bid.bidder, bid.bidAmount, true);

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

        _updateTokenBalance(token, bid.bidder, bid.rewardAmount, true);
        _updateTokenBalance(bidToken, receiver, bid.bidAmount, true);

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
        uint128 recieverBalance = uint128(balances[receiver][bidToken]);
        balances[receiver][bidToken] = 0;
        stakedBidToken -= recieverBalance;
        bidToken.safeTransfer(
            receiver,
            bidToken.balanceOf(address(this)) - stakedBidToken
        );
    }

    function updateReceiver(address newReceiver) external override onlyOwner {
        receiver = newReceiver;
    }

    function updateWhitelistToken(IERC20 token, bool status)
        external
        override
        onlyOwner
    {
        whitelistedTokens[token] = status;
    }
}
