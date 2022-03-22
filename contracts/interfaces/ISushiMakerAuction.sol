// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../libraries/UniswapV2Library.sol";
import "../utils/BoringOwnable.sol";
import "../utils/BoringBatchable.sol";

interface ISushiMakerAuction {
    function start(
        IERC20 token,
        uint128 bidAmount,
        address to
    ) external;

    function placeBid(
        IERC20 token,
        uint128 bidAmount,
        address to
    ) external;

    function end(IERC20 token) external;

    function unwindLP(address token0, address token1) external;

    function skimBidToken() external;

    function updateReceiver(address newReceiver) external;

    struct Bid {
        address bidder;
        uint128 bidAmount;
        uint128 rewardAmount;
        uint64 minTTL;
        uint64 maxTTL;
    }

    event Started(
        IERC20 indexed token,
        address indexed bidder,
        uint128 indexed bidAmount,
        uint128 rewardAmount
    );

    event PlacedBid(
        IERC20 indexed token,
        address indexed bidder,
        uint128 indexed bidAmount
    );

    event Ended(
        IERC20 indexed token,
        address indexed bidder,
        uint128 indexed bidAmount
    );
}
