// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.13;

import { ISuperToken } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import "../interfaces/IStrategy.sol";

interface IStrollManager {
    event TopUpCreated(
        bytes32 indexed id,
        address indexed user,
        address indexed superToken,
        address strategy,
        address liquidityToken,
        uint256 expiry,
        uint256 lowerLimit,
        uint256 upperLimit
    );
    event TopUpDeleted(bytes32 indexed id, address indexed user, address indexed superToken, address strategy, address liquidityToken);
    event PerformedTopUp(bytes32 indexed id, uint256 topUpAmount);
    event AddedApprovedStrategy(address indexed strategy);
    event RemovedApprovedStrategy(address indexed strategy);

    /// Custom error to indicate that null address has been passed.
    error ZeroAddress();

    error InvalidStrategy(address _strategy);

    error TopUpNotRequired(bytes32 index);

    /// Custom error to indicate that supertoken provided isn't supported.
    /// @param superToken Address of the supertoken which isn't supported.
    error UnsupportedSuperToken(address superToken);

    error UnauthorizedCaller(address caller, address expectedCaller);

    error InvalidExpirationTime(uint64 expirationTimeGiven, uint256 timeNow);

    error InsufficientLimits(uint64 limitGiven, uint64 minLimit);

    struct TopUp {
        address user;
        ISuperToken superToken;
        IStrategy strategy;
        address liquidityToken;
        uint64 expiry;
        uint64 lowerLimit;
        uint64 upperLimit;
    }

    /**
     * @notice Adds a strategy to the list of approved strategies.
     * @param _strategy The address of strategy contract to add.
     */
    function addApprovedStrategy(address _strategy) external;

    /**
     * @notice Removes a strategy from the list of approved strategies.
     * @param _strategy The address of strategy contract to remove.
     */
    function removeApprovedStrategy(address _strategy) external;

    /**
     *  @notice Creates a new top up task.
     *  @param _superToken The supertoken to monitor/top up.
     *  @param _strategy The strategy to use for top up.
     *  @param _liquidityToken The token used to convert to _superToken.
     *  @param _expiry Timestamp after which the top up is considered invalid.
     *  @param _lowerLimit Triggers top up if stream can't be continued for this amount of seconds.
     *  @param _upperLimit Increase supertoken balance to continue stream for this amount of seconds.
     */
    function createTopUp(
        address _superToken,
        address _strategy,
        address _liquidityToken,
        uint64 _expiry,
        uint64 _lowerLimit,
        uint64 _upperLimit
    ) external;

    /**
     * @notice Gets the index of a top up.
     * @param _user The creator of top up.
     * @param _superToken The supertoken which is being monitored/top up.
     * @param _liquidityToken The token used to convert to _superToken.
     * @return The index of the top up.
     */
    function getTopUpIndex(
        address _user,
        address _superToken,
        address _liquidityToken
    ) external pure returns (bytes32);

    /**
     * @notice Gets a top up by index.
     * @param _index Index of top up.
     * @return The top up.
     */
    function getTopUpByIndex(bytes32 _index) external view returns (TopUp memory);

    /**
     * @notice Gets a top up by index.
     * @param _user The creator of top up.
     * @param _superToken The supertoken which is being monitored/top up.
     * @param _liquidityToken The token used to convert to _superToken.
     * @return The top up.
     */
    function getTopUp(
        address _user,
        address _superToken,
        address _liquidityToken
    ) external view returns (TopUp memory);

    /**
     * @notice Checks if a top up is required by index.
     * @param _index Index of top up.
     * @return _amount The amount of supertoken to top up.
     */
    function checkTopUpByIndex(bytes32 _index) external view returns (uint256 _amount);

    /**
     * @notice Checks if a top up is required.
     * @param _user The creator of top up.
     * @param _superToken The supertoken which is being monitored/top up.
     * @param _liquidityToken The token used to convert to _superToken.
     * @return _amount The amount of supertoken to top up.
     */
    function checkTopUp(
        address _user,
        address _superToken,
        address _liquidityToken
    ) external view returns (uint256);

    /**
     * @notice Performs a top up by index.
     * @param _index Index of top up.
     */
    function performTopUpByIndex(bytes32 _index) external;

    /**
     * @notice Performs a top up.
     * @param _user The user to top up.
     * @param _superToken The supertoken to monitor/top up.
     * @param _liquidityToken The token used to convert to _superToken.
     */
    function performTopUp(
        address _user,
        address _superToken,
        address _liquidityToken
    ) external;

    /**
     * @notice Deletes a top up by index.
     * @param _index Index of top up.
     */
    function deleteTopUpByIndex(bytes32 _index) external;

    /** @dev IStrollManager.deleteTopUp implementation.
     * @notice Deletes a top up.
     * @param _user The creator of top up.
     * @param _superToken The supertoken which is being monitored/top up.
     * @param _liquidityToken The token used to convert to _superToken.
     */
    function deleteTopUp(
        address _user,
        address _superToken,
        address _liquidityToken
    ) external;

    /**  @dev IStrollManager.deleteBatch implementation.
     * @notice Deletes a batch of top ups.
     * @param _indices Array of indices of top ups to delete.
     */
    function deleteBatch(bytes32[] calldata _indices) external;

    /**
     * @notice Gets the minimum time for _lowerLimit
     */
    function minLower() external view returns (uint64);

    /**
     * @notice Gets the minimum time for _upperLimit
     */
    function minUpper() external view returns (uint64);

    /**
     * @notice Gets the list of approved strategies.
     */
    function approvedStrategies(address _strategy) external view returns (bool);
}
