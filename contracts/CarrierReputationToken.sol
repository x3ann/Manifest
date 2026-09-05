// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title CarrierReputationToken (CRP)
/// @notice Non-transferable-by-default reputation points awarded to Carriers
///         when they successfully complete milestones on the LogisticsEscrow
///         platform. 1 CRP is minted per verified milestone completion.
///         Only the LogisticsEscrow contract (set as `escrow`) may mint.
contract CarrierReputationToken is ERC20, Ownable {
    address public escrow;

    event EscrowSet(address indexed escrow);

    constructor() ERC20("Carrier Reputation Point", "CRP") Ownable(msg.sender) {}

    modifier onlyEscrow() {
        require(msg.sender == escrow, "CRP: caller is not the escrow contract");
        _;
    }

    /// @notice One-time wiring: the platform owner points this token at the
    ///         deployed LogisticsEscrow contract so it is authorised to mint.
    function setEscrow(address _escrow) external onlyOwner {
        require(_escrow != address(0), "CRP: zero address");
        require(escrow == address(0), "CRP: escrow already set");
        escrow = _escrow;
        emit EscrowSet(_escrow);
    }

    /// @notice Mint reputation points to a carrier. Callable only by the
    ///         LogisticsEscrow contract, on verified milestone completion.
    function mintReputation(address carrier, uint256 amount) external onlyEscrow {
        _mint(carrier, amount);
    }

    /// @dev Reputation points are earned, not traded: block ordinary
    ///      transfers between users while still allowing mint (from == 0).
    function transfer(address, uint256) public pure override returns (bool) {
        revert("CRP: reputation points are non-transferable");
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert("CRP: reputation points are non-transferable");
    }
}
