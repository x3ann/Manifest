// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CarrierReputationToken.sol";

/// @title LogisticsEscrow
/// @notice Decentralized escrow for milestone-based logistics agreements
///         between a Shipper (buyer) and a Carrier (service provider).
///         Funds are locked on-chain and released progressively as
///         milestones are verified. Unmet critical milestones past the
///         deadline entitle the Shipper to reclaim the undistributed
///         balance without any intermediary.
contract LogisticsEscrow is ReentrancyGuard {
    // ---------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------

    enum Role { None, Shipper, Carrier }

    enum AgreementStatus {
        Created,      // agreement drafted, awaiting funding
        Funded,       // shipper has locked funds
        InProgress,   // at least one milestone verified & paid
        Completed,    // all milestones verified & paid
        Refunded,     // deadline missed, remaining balance returned to shipper
        Disputed      // carrier disputed a refund claim (manual review flag)
    }

    struct Milestone {
        string description;
        uint16 shareBps;   // share of totalValue in basis points (10000 = 100%)
        bool reported;     // carrier has reported this milestone as done
        bool verified;      // shipper has verified & funds released
    }

    struct Agreement {
        address shipper;
        address carrier;
        uint256 totalValue;
        uint256 fundedAmount;
        uint256 releasedAmount;
        uint256 deadline;      // unix timestamp
        AgreementStatus status;
        uint8 milestoneCount;
    }

    // ---------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------

    CarrierReputationToken public immutable reputationToken;

    mapping(address => Role) public roles;
    mapping(uint256 => Agreement) public agreements;
    mapping(uint256 => Milestone[]) private _milestones;
    uint256 public agreementCount;

    uint256 public constant REPUTATION_PER_MILESTONE = 1e18; // 1 CRP token

    // ---------------------------------------------------------------
    // Events (form the on-chain transaction history)
    // ---------------------------------------------------------------

    event UserRegistered(address indexed user, Role role);
    event AgreementCreated(uint256 indexed id, address indexed shipper, address indexed carrier, uint256 totalValue, uint256 deadline);
    event AgreementFunded(uint256 indexed id, uint256 amount);
    event MilestoneReported(uint256 indexed id, uint256 indexed milestoneIndex, address indexed carrier);
    event MilestoneVerified(uint256 indexed id, uint256 indexed milestoneIndex, uint256 payout);
    event AgreementCompleted(uint256 indexed id);
    event RefundIssued(uint256 indexed id, address indexed shipper, uint256 amount);

    // ---------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------

    modifier onlyShipperOf(uint256 id) {
        require(agreements[id].shipper == msg.sender, "Escrow: not the shipper");
        _;
    }

    modifier onlyCarrierOf(uint256 id) {
        require(agreements[id].carrier == msg.sender, "Escrow: not the carrier");
        _;
    }

    modifier agreementExists(uint256 id) {
        require(id < agreementCount, "Escrow: unknown agreement");
        _;
    }

    constructor(address _reputationToken) {
        reputationToken = CarrierReputationToken(_reputationToken);
    }

    // ---------------------------------------------------------------
    // 1. User registration & authentication
    // ---------------------------------------------------------------
    // Note: "authentication" on-chain is simply "msg.sender controls a
    // private key" — every state-changing call below is authenticated by
    // the caller's wallet signature at the transaction level. Registration
    // just assigns the on-chain role used for access control.

    function registerAsShipper() external {
        require(roles[msg.sender] == Role.None, "Escrow: already registered");
        roles[msg.sender] = Role.Shipper;
        emit UserRegistered(msg.sender, Role.Shipper);
    }

    function registerAsCarrier() external {
        require(roles[msg.sender] == Role.None, "Escrow: already registered");
        roles[msg.sender] = Role.Carrier;
        emit UserRegistered(msg.sender, Role.Carrier);
    }

    // ---------------------------------------------------------------
    // 2. Agreement creation
    // ---------------------------------------------------------------

    /// @param carrier address of the registered Carrier
    /// @param totalValue total payload value in wei to be escrowed
    /// @param milestoneDescriptions human-readable checkpoint names
    /// @param milestoneSharesBps payout share per milestone, in basis points; must sum to 10000
    /// @param deadline unix timestamp by which the FINAL milestone must be verified
    function createAgreement(
        address carrier,
        uint256 totalValue,
        string[] calldata milestoneDescriptions,
        uint16[] calldata milestoneSharesBps,
        uint256 deadline
    ) external returns (uint256 id) {
        require(roles[msg.sender] == Role.Shipper, "Escrow: caller is not a Shipper");
        require(roles[carrier] == Role.Carrier, "Escrow: counterparty is not a Carrier");
        require(totalValue > 0, "Escrow: totalValue must be > 0");
        require(deadline > block.timestamp, "Escrow: deadline must be in the future");
        require(milestoneDescriptions.length > 0, "Escrow: at least one milestone required");
        require(milestoneDescriptions.length == milestoneSharesBps.length, "Escrow: milestone array length mismatch");

        uint256 sum;
        for (uint256 i = 0; i < milestoneSharesBps.length; i++) {
            sum += milestoneSharesBps[i];
        }
        require(sum == 10000, "Escrow: milestone shares must sum to 100%");

        id = agreementCount++;
        Agreement storage a = agreements[id];
        a.shipper = msg.sender;
        a.carrier = carrier;
        a.totalValue = totalValue;
        a.deadline = deadline;
        a.status = AgreementStatus.Created;
        a.milestoneCount = uint8(milestoneDescriptions.length);

        for (uint256 i = 0; i < milestoneDescriptions.length; i++) {
            _milestones[id].push(Milestone({
                description: milestoneDescriptions[i],
                shareBps: milestoneSharesBps[i],
                reported: false,
                verified: false
            }));
        }

        emit AgreementCreated(id, msg.sender, carrier, totalValue, deadline);
    }

    // ---------------------------------------------------------------
    // 3. Funding mechanism
    // ---------------------------------------------------------------

    function fundAgreement(uint256 id) external payable agreementExists(id) onlyShipperOf(id) nonReentrant {
        Agreement storage a = agreements[id];
        require(a.status == AgreementStatus.Created, "Escrow: agreement not in Created state");
        require(msg.value == a.totalValue, "Escrow: must fund exact totalValue");

        a.fundedAmount = msg.value;
        a.status = AgreementStatus.Funded;

        emit AgreementFunded(id, msg.value);
    }

    // ---------------------------------------------------------------
    // 4. Milestone & payout management
    // ---------------------------------------------------------------

    /// @notice Carrier reports a milestone as physically/operationally complete.
    function reportMilestone(uint256 id, uint256 milestoneIndex)
        external
        agreementExists(id)
        onlyCarrierOf(id)
    {
        Agreement storage a = agreements[id];
        require(
            a.status == AgreementStatus.Funded || a.status == AgreementStatus.InProgress,
            "Escrow: agreement not active"
        );
        Milestone storage m = _milestones[id][milestoneIndex];
        require(!m.verified, "Escrow: milestone already paid");
        m.reported = true;

        emit MilestoneReported(id, milestoneIndex, msg.sender);
    }

    /// @notice Shipper cryptographically verifies a reported milestone,
    ///         triggering an immediate, automatic, proportional payout to
    ///         the Carrier and minting one reputation point.
    function verifyMilestone(uint256 id, uint256 milestoneIndex)
        external
        agreementExists(id)
        onlyShipperOf(id)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(
            a.status == AgreementStatus.Funded || a.status == AgreementStatus.InProgress,
            "Escrow: agreement not active"
        );
        Milestone storage m = _milestones[id][milestoneIndex];
        require(m.reported, "Escrow: milestone not yet reported by carrier");
        require(!m.verified, "Escrow: milestone already paid");

        m.verified = true;
        uint256 payout = (a.totalValue * m.shareBps) / 10000;
        a.releasedAmount += payout;
        a.status = AgreementStatus.InProgress;

        // Reward carrier reputation on successful, verified completion.
        reputationToken.mintReputation(a.carrier, REPUTATION_PER_MILESTONE);

        (bool sent, ) = a.carrier.call{value: payout}("");
        require(sent, "Escrow: payout transfer failed");

        emit MilestoneVerified(id, milestoneIndex, payout);

        if (_allMilestonesVerified(id)) {
            a.status = AgreementStatus.Completed;
            emit AgreementCompleted(id);
        }
    }

    function _allMilestonesVerified(uint256 id) internal view returns (bool) {
        Milestone[] storage ms = _milestones[id];
        for (uint256 i = 0; i < ms.length; i++) {
            if (!ms[i].verified) return false;
        }
        return true;
    }

    // ---------------------------------------------------------------
    // 5. Automatic refund / dispute handling
    // ---------------------------------------------------------------

    /// @notice After the deadline, if the agreement is not yet Completed,
    ///         anyone may trigger this to automatically return the
    ///         remaining, un-released escrow balance to the Shipper. This
    ///         is the on-chain equivalent of an "automatic" refund: the
    ///         outcome is fully determined by contract state, not by
    ///         discretionary approval.
    function claimRefund(uint256 id) external agreementExists(id) nonReentrant {
        Agreement storage a = agreements[id];
        require(
            a.status == AgreementStatus.Funded || a.status == AgreementStatus.InProgress,
            "Escrow: agreement not refundable"
        );
        require(block.timestamp > a.deadline, "Escrow: deadline not yet passed");

        uint256 remaining = a.fundedAmount - a.releasedAmount;
        require(remaining > 0, "Escrow: nothing left to refund");

        a.releasedAmount = a.fundedAmount; // zero-out remaining balance
        a.status = AgreementStatus.Refunded;

        (bool sent, ) = a.shipper.call{value: remaining}("");
        require(sent, "Escrow: refund transfer failed");

        emit RefundIssued(id, a.shipper, remaining);
    }

    // ---------------------------------------------------------------
    // 6. Transaction history / read access
    // ---------------------------------------------------------------

    function getAgreement(uint256 id) external view agreementExists(id) returns (
        address shipper,
        address carrier,
        uint256 totalValue,
        uint256 fundedAmount,
        uint256 releasedAmount,
        uint256 deadline,
        AgreementStatus status,
        uint8 milestoneCount
    ) {
        Agreement storage a = agreements[id];
        return (a.shipper, a.carrier, a.totalValue, a.fundedAmount, a.releasedAmount, a.deadline, a.status, a.milestoneCount);
    }

    function getMilestone(uint256 id, uint256 index) external view agreementExists(id) returns (
        string memory description,
        uint16 shareBps,
        bool reported,
        bool verified
    ) {
        Milestone storage m = _milestones[id][index];
        return (m.description, m.shareBps, m.reported, m.verified);
    }

    function getMilestones(uint256 id) external view agreementExists(id) returns (Milestone[] memory) {
        return _milestones[id];
    }

    /// @notice Convenience view: escrow balance still locked for an agreement.
    function escrowBalance(uint256 id) external view agreementExists(id) returns (uint256) {
        Agreement storage a = agreements[id];
        return a.fundedAmount - a.releasedAmount;
    }
}
