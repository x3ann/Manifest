# Manifest

Manifest is a decentralized escrow and milestone-based logistics platform built for the Ethereum Sepolia test network. It allows a Shipper to create and fund a logistics agreement, a Carrier to report completed milestones, and the Shipper to verify the work before the smart contract releases the corresponding payment. Each verified milestone also awards the Carrier one non-transferable Carrier Reputation Point (CRP).

This project was developed for **BMIS2003 Blockchain Application Development**.

## Main Features

- Wallet-based registration as a **Shipper** or **Carrier**.
- Creation of logistics agreements with a Carrier, total value, deadline, and multiple milestones.
- Percentage-based milestone allocation using basis points, where 10,000 basis points equals 100%.
- Exact-value ETH funding held by the escrow smart contract.
- Carrier milestone reporting and Shipper verification.
- Automatic proportional ETH release after milestone verification.
- One CRP minted to the Carrier for every verified milestone.
- Non-transferable reputation points that cannot be bought or transferred between users.
- Refund of the remaining escrow balance after an agreement deadline has passed.
- Dashboard for viewing all agreements or agreements involving the connected wallet.
- Agreement detail screen with balances, milestones, payout calculations, and deadline countdowns.
- Transaction ledger based on emitted smart contract events, with CSV export.
- Reputation lookup for any Ethereum wallet address.
- Sepolia network detection and wallet network-switch assistance.
- Browser storage for retaining the deployed contract addresses.

## Technology Stack

| Component | Technology |
| --- | --- |
| Blockchain | Ethereum Sepolia testnet |
| Smart contracts | Solidity `^0.8.20` |
| Contract libraries | OpenZeppelin Contracts 5 |
| Browser integration | ethers.js 6.13.4 |
| Wallet | MetaMask or another injected Ethereum wallet |
| Frontend | HTML5, CSS3, and vanilla JavaScript |
| Compilation | Node.js and solc-js |

## Project Structure

```text
manifest-source/
├── contracts/
│   ├── CarrierReputationToken.sol
│   └── LogisticsEscrow.sol
├── frontend/
│   ├── app.js
│   ├── index.html
│   ├── styles.css
│   ├── CarrierReputationToken.abi.json
│   └── LogisticsEscrow.abi.json
├── build.json
├── compile.js
└── README.md
```

### Source File Responsibilities

- `contracts/LogisticsEscrow.sol` contains registration, agreement creation, escrow funding, milestone reporting, milestone verification, ETH settlement, refunds, state queries, and event definitions.
- `contracts/CarrierReputationToken.sol` implements the CRP reputation token. Only the configured LogisticsEscrow contract can mint CRP, and ordinary token transfers are disabled.
- `frontend/index.html` contains the seven application views and loads ethers.js.
- `frontend/styles.css` defines the layout, responsive styling, forms, cards, tables, status indicators, and visual theme.
- `frontend/app.js` connects the wallet, checks the network, loads the contract ABIs, submits transactions, reads contract state, displays events, calculates countdowns, and exports ledger records.
- `frontend/*.abi.json` contains the contract interfaces used by the browser application.
- `compile.js` compiles both contracts with optimizer settings of 200 runs.
- `build.json` contains the generated ABI and bytecode compiler output and can be regenerated.

## System Architecture

Manifest uses a client-to-blockchain architecture without a backend server:

1. The static browser interface displays application data and prepares contract calls.
2. The connected wallet controls the account and private key and asks the user to approve every state-changing transaction.
3. The wallet sends signed transactions to Ethereum Sepolia.
4. `LogisticsEscrow` validates permissions, stores agreements and milestones, holds ETH, and performs payments or refunds.
5. `CarrierReputationToken` stores CRP balances and accepts minting requests only from the configured escrow contract.
6. The browser reads current contract state and emitted events directly from Ethereum.

## User Roles

### Shipper

The Shipper creates an agreement, selects a registered Carrier, defines its milestones and deadline, deposits the exact agreement value, and verifies milestones reported by the Carrier. Verification releases the relevant share of ETH to the Carrier.

### Carrier

The Carrier accepts work through an agreement created by a Shipper and reports milestones after completing them. The Carrier receives the milestone payment and one CRP only after the Shipper verifies the report.

### Public User

Public blockchain information can be read without being a party to an agreement. After a missed deadline, any wallet may trigger `claimRefund`; the contract always sends the eligible remaining balance to the agreement's Shipper.

## Agreement Lifecycle

```text
Created -> Funded -> InProgress -> Completed
                         |
                         +-------> Refunded (after the deadline)
```

1. A wallet registers as a Shipper or Carrier.
2. A Shipper creates an agreement with a registered Carrier.
3. The Shipper funds the agreement with the exact specified ETH value.
4. The Carrier reports a completed milestone.
5. The Shipper verifies that milestone.
6. The escrow releases the milestone's proportional payment and mints one CRP to the Carrier.
7. Steps 4–6 repeat until every milestone is verified and the agreement becomes `Completed`.
8. If the deadline passes before completion, `claimRefund` returns the unreleased balance to the Shipper and changes the agreement to `Refunded`.

## Smart Contracts

### LogisticsEscrow

Important write functions:

| Function | Authorized caller | Purpose |
| --- | --- | --- |
| `registerAsShipper()` | Unregistered wallet | Registers the caller as a Shipper |
| `registerAsCarrier()` | Unregistered wallet | Registers the caller as a Carrier |
| `createAgreement(...)` | Registered Shipper | Creates an agreement and its milestones |
| `fundAgreement(id)` | Agreement Shipper | Deposits the agreement's exact ETH value |
| `reportMilestone(id, index)` | Assigned Carrier | Marks a milestone as reported |
| `verifyMilestone(id, index)` | Agreement Shipper | Verifies work, pays the Carrier, and mints CRP |
| `claimRefund(id)` | Any wallet after deadline | Returns the remaining balance to the Shipper |

Important read functions and public state:

- `getAgreement(id)` returns the parties, values, deadline, status, and milestone count.
- `getMilestone(id, index)` returns one milestone's description, share, reported state, and verified state.
- `getMilestones(id)` returns all milestones belonging to an agreement.
- `escrowBalance(id)` returns the agreement balance that remains locked.
- `agreementCount()` returns the number of created agreements.
- `roles(address)` returns a wallet's registered role.

The contract emits `UserRegistered`, `AgreementCreated`, `AgreementFunded`, `MilestoneReported`, `MilestoneVerified`, `AgreementCompleted`, and `RefundIssued` events. These events form the on-chain transaction history displayed by the frontend.

### CarrierReputationToken

The token is named **Carrier Reputation Point** and uses the symbol **CRP**. The token owner must call `setEscrow` once after deployment. Only that escrow address can call `mintReputation`. The contract overrides `transfer` and `transferFrom` so that reputation cannot be transferred between wallets.

## Prerequisites

Before running the project, install or prepare:

- A recent version of [Node.js](https://nodejs.org/).
- MetaMask or another browser wallet that exposes an Ethereum provider.
- Sepolia test ETH for deployment and transactions.
- An Ethereum development environment such as Remix for deployment.
- Two test wallet accounts if demonstrating both Shipper and Carrier roles.

Do not store wallet recovery phrases, private keys, passwords, or API keys in this repository.

## Compile the Contracts Locally

Open a terminal in the repository folder and install the required compiler packages:

```bash
npm install solc@0.8.20 @openzeppelin/contracts@5
node compile.js
```

Successful compilation updates `build.json` with the generated ABIs and bytecode. The compiler uses optimization with 200 runs.

## Deploy on Sepolia with Remix

1. Open [Remix IDE](https://remix.ethereum.org/).
2. Create a workspace and upload both files from the `contracts` directory.
3. Open the Solidity Compiler panel.
4. Select a compiler compatible with Solidity 0.8.20.
5. Enable optimization and set the optimizer runs to `200`.
6. Compile `CarrierReputationToken.sol` and `LogisticsEscrow.sol`.
7. In **Deploy & Run Transactions**, select **Injected Provider - MetaMask**.
8. Confirm that MetaMask is connected to Sepolia and has sufficient Sepolia ETH.
9. Deploy `CarrierReputationToken` first. Its constructor has no arguments.
10. Copy the deployed token address.
11. Deploy `LogisticsEscrow` and supply the token address as `_reputationToken`.
12. Copy the deployed escrow address.
13. Open the deployed `CarrierReputationToken` contract and call `setEscrow` with the LogisticsEscrow address from the token owner's wallet.

The `setEscrow` operation is mandatory and can be completed only once. If it is not configured correctly, milestone verification will fail when the escrow attempts to mint CRP.

## Run the Frontend

The frontend is static and does not require a JavaScript build process. Serve it through a local web server instead of opening `index.html` directly.

Using Python:

```bash
cd frontend
python -m http.server 8000
```

Then open `http://localhost:8000` in a browser containing MetaMask.

Alternatively, use a development server such as the Visual Studio Code Live Server extension.

## Configure and Use the Application

1. Open the application and connect MetaMask.
2. Ensure the selected wallet network is Sepolia. The expected chain ID is `11155111` (`0xaa36a7`).
3. Open **Setup**.
4. Enter the deployed LogisticsEscrow and CarrierReputationToken addresses.
5. Select **Save & Connect Contracts**.
6. Register one test wallet as a Shipper.
7. Switch to a second wallet and register it as a Carrier.
8. Switch back to the Shipper and open **New Agreement**.
9. Enter the Carrier address, total ETH value, future deadline, and milestone descriptions and percentages. The percentages must total exactly 100%.
10. Submit the agreement and approve the wallet transaction.
11. Open the agreement from the Dashboard and fund it with the exact total value.
12. Switch to the Carrier account and report a milestone.
13. Switch to the Shipper account and verify the reported milestone.
14. Confirm that the milestone payment reaches the Carrier and the Carrier receives one CRP.
15. Repeat the report and verification process for the remaining milestones.

The application contains the following views:

- **Login** — connects the wallet, shows the current role and CRP balance, and supports role registration.
- **Dashboard** — displays all agreements or agreements involving the connected account.
- **New Agreement** — creates a logistics agreement with dynamic milestones.
- **Agreement Detail** — displays agreement data, milestone actions, escrow balance, and deadline countdown.
- **Transaction Ledger** — displays recent contract events and supports CSV export.
- **Reputation Lookup** — checks the CRP balance of any valid wallet address.
- **Setup** — stores and connects the two deployed contract addresses.

## Security Measures

- `ReentrancyGuard` protects funding, milestone verification, and refund operations.
- Role and agreement-party modifiers restrict sensitive operations.
- Contract state is updated before external ETH transfers.
- Funding must match the agreement value exactly.
- Milestone shares must total 10,000 basis points.
- A milestone must be reported before it can be verified.
- A verified milestone cannot be paid twice.
- Refunds are available only after the stored deadline.
- Only the configured escrow contract can mint CRP.
- CRP transfers between users are disabled.
- State-changing operations require wallet signatures.

## Known Limitations

- Smart contracts cannot initiate transactions themselves; reporting, verification, and refunds require a wallet to submit a transaction.
- The `Disputed` status exists in the enumeration, but the current version does not implement arbitration or dispute-management functions.
- A Carrier depends on the Shipper to verify a reported milestone; there is no independent oracle or timeout-based verification.
- Integer division may leave a very small rounding remainder for some agreement values and milestone distributions.
- A milestone can be reported repeatedly before it is verified, producing repeated report events.
- The Dashboard reads agreements sequentially and may become slower as the agreement count increases.
- The Transaction Ledger scans only the latest 9,000 blocks instead of using a dedicated blockchain indexer.
- Saved contract addresses are checked for valid address format but not for deployed bytecode or ABI compatibility.
- The browser client depends on externally hosted ethers.js and web fonts.
- The repository does not currently include an automated smart contract or browser test suite.
- CRP awards are fixed at one token per verified milestone and do not consider shipment value, difficulty, timeliness, or service quality.
- Agreement details and transactions are publicly visible on Ethereum.

## Troubleshooting

### Wallet does not connect

Confirm that MetaMask is installed, unlocked, and permitted to connect to the local website. Refresh the page after unlocking the wallet.

### Wrong network warning

Switch MetaMask to Sepolia or use the application's network-switch button. The application expects chain ID `11155111`.

### Contracts are not connected

Open Setup and confirm that both addresses are valid Sepolia addresses from the same deployment. Also verify that the token's `escrow` value equals the deployed LogisticsEscrow address.

### Agreement creation fails

Confirm that the connected wallet is registered as a Shipper, the Carrier address is registered as a Carrier, the deadline is in the future, the total value is greater than zero, and all milestone percentages total 100%.

### Funding fails

Only the agreement's Shipper can fund it, the agreement must still be in the `Created` state, and the transaction value must exactly equal the agreement value.

### Verification fails

Confirm that the Carrier has reported the milestone, the milestone has not already been verified, the agreement is active, the Shipper account is connected, and `CarrierReputationToken.setEscrow` was completed correctly.

## Academic Purpose

This repository is an educational blockchain application. It has not undergone a production security audit and should not be used to hold real funds without additional testing, review, monitoring, and security controls.
