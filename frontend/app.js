/* Manifest — Decentralized Logistics Escrow frontend
   Integrates directly with the LogisticsEscrow + CarrierReputationToken
   contracts via ethers.js and an injected wallet (MetaMask). */

const STATUS_LABELS = ["Created", "Funded", "In Progress", "Completed", "Refunded", "Disputed"];
const STATUS_CLASS = ["neutral", "neutral", "neutral", "ok", "warn", "warn"];

let provider, signer, userAddress;
let escrowContract, tokenContract;
let escrowAbi, tokenAbi;

const els = {};
document.querySelectorAll("[id]").forEach(el => els[el.id] = el);

// ---------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------
document.getElementById("tabbar").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
});

// ---------------------------------------------------------------
// ABI loading
// ---------------------------------------------------------------
async function loadAbis() {
  [escrowAbi, tokenAbi] = await Promise.all([
    fetch("LogisticsEscrow.abi.json").then(r => r.json()),
    fetch("CarrierReputationToken.abi.json").then(r => r.json()),
  ]);
}

// ---------------------------------------------------------------
// Wallet connection
// ---------------------------------------------------------------
els["connect-btn"].addEventListener("click", connectWallet);

const SEPOLIA_CHAIN_ID = 11155111n;
const SEPOLIA_HEX = "0xaa36a7";

async function connectWallet() {
  if (!window.ethereum) {
    setStatus(els["setup-status"], "No injected wallet found. Install MetaMask.", "err");
    return;
  }
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  userAddress = await signer.getAddress();

  const network = await provider.getNetwork();
  els["network-pill"].textContent = `chain ${network.chainId}`;
  els["network-pill"].classList.add("pill-good");
  els["connect-btn"].textContent = shortAddr(userAddress);

  checkNetwork(network.chainId);
  window.ethereum.on && window.ethereum.on("chainChanged", () => window.location.reload());

  reconnectContracts();
  await refreshRolePill(); // also updates login screen + CRP pill
  setStatus(els["login-status"], "Wallet connected.", "ok");
}

function checkNetwork(chainId) {
  const wrong = chainId !== SEPOLIA_CHAIN_ID;
  els["network-warning"].classList.toggle("hidden", !wrong);
}

els["switch-network-btn"].addEventListener("click", async () => {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_HEX }],
    });
  } catch (switchErr) {
    // Chain not added to this wallet yet — offer to add it
    if (switchErr.code === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: SEPOLIA_HEX,
            chainName: "Sepolia",
            nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://rpc.sepolia.org"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          }],
        });
      } catch (addErr) {
        setStatus(els["login-status"], parseErr(addErr), "err");
      }
    } else {
      setStatus(els["login-status"], parseErr(switchErr), "err");
    }
  }
});

function shortAddr(a) { return a.slice(0, 6) + "…" + a.slice(-4); }

// CRP is an 18-decimal ERC-20 like ETH itself — convert raw base units into
// a whole "how many milestones" count for display, since CRP is always minted
// in whole 1-token amounts (REPUTATION_PER_MILESTONE = 1e18 per milestone).
function formatCrp(rawBalance) {
  const asFloat = Number(ethers.formatUnits(rawBalance, 18));
  return asFloat.toString();
}

function reconnectContracts() {
  const escrowAddr = localStorage.getItem("manifest_escrow_addr");
  const tokenAddr = localStorage.getItem("manifest_token_addr");
  if (escrowAddr && signer) escrowContract = new ethers.Contract(escrowAddr, escrowAbi, signer);
  if (tokenAddr && signer) tokenContract = new ethers.Contract(tokenAddr, tokenAbi, signer);
}

// ---------------------------------------------------------------
// Setup panel — contract addresses & role registration
// ---------------------------------------------------------------
els["input-escrow-addr"].value = localStorage.getItem("manifest_escrow_addr") || "";
els["input-token-addr"].value = localStorage.getItem("manifest_token_addr") || "";

els["save-config-btn"].addEventListener("click", () => {
  const e = els["input-escrow-addr"].value.trim();
  const t = els["input-token-addr"].value.trim();
  if (!ethers.isAddress(e) || !ethers.isAddress(t)) {
    setStatus(els["setup-status"], "Enter two valid contract addresses.", "err");
    return;
  }
  localStorage.setItem("manifest_escrow_addr", e);
  localStorage.setItem("manifest_token_addr", t);
  reconnectContracts();
  setStatus(els["setup-status"], "Contracts wired. You can now register a role and use the app.", "ok");
});

els["register-shipper-btn"].addEventListener("click", () => registerRole("registerAsShipper", "Shipper"));
els["register-carrier-btn"].addEventListener("click", () => registerRole("registerAsCarrier", "Carrier"));

async function registerRole(method, label) {
  if (!requireContracts()) return;
  try {
    setStatus(els["register-status"], `Sending ${label} registration…`);
    const tx = await escrowContract[method]();
    await tx.wait();
    setStatus(els["register-status"], `Registered as ${label}. Tx: ${tx.hash}`, "ok");
    await refreshRolePill();
  } catch (err) {
    setStatus(els["register-status"], parseErr(err), "err");
  }
}

let currentRole = 0; // 0 = none, 1 = Shipper, 2 = Carrier

async function refreshRolePill() {
  if (!escrowContract || !userAddress) return;
  try {
    const role = await escrowContract.roles(userAddress);
    currentRole = Number(role);
    const label = ["No Role", "Shipper", "Carrier"][currentRole] || "No Role";
    els["role-pill"].textContent = label;
    els["role-pill"].classList.toggle("pill-good", currentRole > 0);
  } catch (_) {}
  await refreshCrpBalance();
  updateLoginScreen();
}

async function refreshCrpBalance() {
  if (!tokenContract || !userAddress) {
    els["crp-pill"].classList.add("hidden");
    return;
  }
  try {
    const bal = await tokenContract.balanceOf(userAddress);
    els["crp-pill"].textContent = `CRP: ${formatCrp(bal)}`;
    els["crp-pill"].classList.remove("hidden");
  } catch (_) {
    els["crp-pill"].classList.add("hidden");
  }
}

// ---------------------------------------------------------------
// Login / Logout screen
// ---------------------------------------------------------------
els["login-connect-btn"].addEventListener("click", connectWallet);
els["login-be-shipper-btn"].addEventListener("click", () => loginRegister("registerAsShipper", "Shipper"));
els["login-be-carrier-btn"].addEventListener("click", () => loginRegister("registerAsCarrier", "Carrier"));
els["login-goto-dashboard-btn"].addEventListener("click", () => {
  document.querySelector('[data-tab="dashboard"]').click();
});
els["logout-btn"].addEventListener("click", logout);

async function loginRegister(method, label) {
  if (!requireContracts()) return;
  try {
    setStatus(els["login-status"], `Sending ${label} registration…`);
    const tx = await escrowContract[method]();
    await tx.wait();
    setStatus(els["login-status"], `Registered as ${label}.`, "ok");
    await refreshRolePill();
  } catch (err) {
    setStatus(els["login-status"], parseErr(err), "err");
  }
}

function logout() {
  provider = null;
  signer = null;
  userAddress = null;
  escrowContract = null;
  tokenContract = null;
  currentRole = 0;
  els["connect-btn"].textContent = "Connect Wallet";
  els["network-pill"].textContent = "not connected";
  els["network-pill"].classList.remove("pill-good");
  els["role-pill"].textContent = "no role";
  els["role-pill"].classList.remove("pill-good");
  els["crp-pill"].classList.add("hidden");
  setStatus(els["login-status"], "Logged out of this session. Your wallet extension is still open — reconnect to continue.", "ok");
  updateLoginScreen();
  document.querySelector('[data-tab="login"]').click();
}

function updateLoginScreen() {
  const stepConnect = els["login-step-connect"];
  const stepChoose = els["login-step-choose"];
  const stepIn = els["login-step-in"];
  [stepConnect, stepChoose, stepIn].forEach(s => s.classList.add("hidden"));

  if (!userAddress) {
    stepConnect.classList.remove("hidden");
    return;
  }
  if (currentRole === 0) {
    els["login-addr"].textContent = shortAddr(userAddress);
    stepChoose.classList.remove("hidden");
    return;
  }
  const label = currentRole === 1 ? "Shipper" : "Carrier";
  els["login-role-label"].textContent = label;
  els["login-addr-2"].textContent = userAddress;
  stepIn.classList.remove("hidden");
}

// ---------------------------------------------------------------
// Create Agreement panel
// ---------------------------------------------------------------
function addMilestoneRow(desc = "", pct = "") {
  const row = document.createElement("div");
  row.className = "milestone-row";
  row.innerHTML = `
    <input type="text" class="ms-desc" placeholder="e.g. Pickup confirmed" value="${desc}">
    <input type="number" class="ms-pct" placeholder="% share" min="0" max="100" value="${pct}">
    <button type="button" class="remove-row" title="Remove">✕</button>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => { row.remove(); updateSplitTotal(); });
  row.querySelectorAll("input").forEach(i => i.addEventListener("input", updateSplitTotal));
  els["milestone-rows"].appendChild(row);
  updateSplitTotal();
}
els["add-milestone-btn"].addEventListener("click", () => addMilestoneRow());

function updateSplitTotal() {
  const pcts = [...document.querySelectorAll(".ms-pct")].map(i => Number(i.value) || 0);
  const total = pcts.reduce((a, b) => a + b, 0);
  els["split-total-val"].textContent = total;
}

// seed with two example milestones
addMilestoneRow("Pickup confirmed", 30);
addMilestoneRow("Final delivery confirmed", 70);

els["create-agreement-btn"].addEventListener("click", async () => {
  if (!requireContracts()) return;
  const carrier = els["cf-carrier"].value.trim();
  const valueEth = els["cf-value"].value.trim();
  const deadlineLocal = els["cf-deadline"].value;
  const rows = [...document.querySelectorAll(".milestone-row")];

  if (!ethers.isAddress(carrier)) return setStatus(els["create-status"], "Enter a valid carrier address.", "err");
  if (!valueEth || Number(valueEth) <= 0) return setStatus(els["create-status"], "Enter a total payload value > 0.", "err");
  if (!deadlineLocal) return setStatus(els["create-status"], "Pick a deadline.", "err");
  if (rows.length === 0) return setStatus(els["create-status"], "Add at least one milestone.", "err");

  const descriptions = rows.map(r => r.querySelector(".ms-desc").value.trim());
  const shares = rows.map(r => Math.round(Number(r.querySelector(".ms-pct").value || 0) * 100)); // bps
  if (descriptions.some(d => !d)) return setStatus(els["create-status"], "Every milestone needs a description.", "err");
  if (shares.reduce((a, b) => a + b, 0) !== 10000) return setStatus(els["create-status"], "Milestone shares must sum to exactly 100%.", "err");

  const deadlineTs = Math.floor(new Date(deadlineLocal).getTime() / 1000);

  try {
    setStatus(els["create-status"], "Submitting createAgreement transaction…");
    const tx = await escrowContract.createAgreement(
      carrier,
      ethers.parseEther(valueEth),
      descriptions,
      shares,
      deadlineTs
    );
    const receipt = await tx.wait();
    setStatus(els["create-status"], `Agreement created. Tx: ${tx.hash}`, "ok");
    loadDashboard();
  } catch (err) {
    setStatus(els["create-status"], parseErr(err), "err");
  }
});

// ---------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------
els["refresh-dashboard-btn"].addEventListener("click", loadDashboard);
document.querySelector('[data-tab="dashboard"]').addEventListener("click", loadDashboard);

let dashboardFilter = "all"; // "all" | "mine"
document.querySelectorAll("#dashboard-filter-toggle .filter-opt").forEach(btn => {
  btn.addEventListener("click", () => {
    dashboardFilter = btn.dataset.filter;
    document.querySelectorAll("#dashboard-filter-toggle .filter-opt").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    els["dashboard-title"].textContent = dashboardFilter === "mine" ? "My Agreements" : "All Agreements";
    els["dashboard-hint"].textContent = dashboardFilter === "mine"
      ? "Agreements where the connected wallet is the Shipper or the Carrier."
      : "Every logistics contract created on this deployment, read live from chain state.";
    loadDashboard();
  });
});

// ---------------------------------------------------------------
// Countdown helper — shared by Dashboard rows and Agreement Detail
// ---------------------------------------------------------------
function formatCountdown(deadlineTs) {
  const now = Date.now();
  const deadlineMs = deadlineTs * 1000;
  const diff = deadlineMs - now;
  if (diff <= 0) {
    const overMs = -diff;
    const overH = Math.floor(overMs / 3600000);
    return { text: overH < 1 ? "Deadline passed — refund eligible" : `Passed ${overH}h ago — refund eligible`, cls: "expired" };
  }
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  let text;
  if (days > 0) text = `${days}d ${hours}h remaining`;
  else if (hours > 0) text = `${hours}h ${mins}m remaining`;
  else text = `${mins}m remaining`;
  const soon = diff < 3600000; // under 1 hour
  return { text, cls: soon ? "warn-soon" : "" };
}

async function loadDashboard() {
  if (!escrowContract) return;
  const tbody = document.querySelector("#dashboard-table tbody");
  tbody.innerHTML = "";
  try {
    const count = Number(await escrowContract.agreementCount());
    let shown = 0;
    for (let id = 0; id < count; id++) {
      const a = await escrowContract.getAgreement(id);
      if (dashboardFilter === "mine" && userAddress) {
        const mine = a.shipper.toLowerCase() === userAddress.toLowerCase() || a.carrier.toLowerCase() === userAddress.toLowerCase();
        if (!mine) continue;
      }
      shown++;
      const tr = document.createElement("tr");
      const cd = formatCountdown(Number(a.deadline));
      tr.innerHTML = `
        <td>${id}</td>
        <td class="mono">${shortAddr(a.shipper)}</td>
        <td class="mono">${shortAddr(a.carrier)}</td>
        <td>${ethers.formatEther(a.totalValue)} ETH</td>
        <td>${ethers.formatEther(a.fundedAmount - a.releasedAmount)} ETH</td>
        <td>${new Date(Number(a.deadline) * 1000).toLocaleString()}</td>
        <td class="countdown ${cd.cls}">${cd.text}</td>
        <td><span class="status-chip ${STATUS_CLASS[Number(a.status)]}">${STATUS_LABELS[Number(a.status)]}</span></td>
        <td><button class="small-btn" data-open="${id}">Open</button></td>
      `;
      tbody.appendChild(tr);
    }
    els["dashboard-empty"].style.display = shown === 0 ? "block" : "none";
    els["dashboard-empty"].textContent = shown === 0
      ? (dashboardFilter === "mine" ? "No agreements found for this wallet. Connect the right account, or switch to \"All Agreements\"." : "No agreements yet — create the first one under \"New Agreement\".")
      : "";
    tbody.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => {
      document.querySelector('[data-tab="agreement"]').click();
      els["detail-id-input"].value = b.dataset.open;
      loadAgreementDetail();
    }));
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------
// Agreement Detail
// ---------------------------------------------------------------
els["load-agreement-btn"].addEventListener("click", loadAgreementDetail);

let currentAgreementId = null;

async function loadAgreementDetail() {
  if (!requireContracts()) return;
  const id = els["detail-id-input"].value;
  if (id === "") return;
  currentAgreementId = Number(id);

  try {
    const a = await escrowContract.getAgreement(id);
    els["agreement-card"].classList.remove("hidden");
    els["agreement-empty"].style.display = "none";

    els["d-shipper"].textContent = a.shipper;
    els["d-carrier"].textContent = a.carrier;
    els["d-total"].textContent = ethers.formatEther(a.totalValue) + " ETH";
    els["d-balance"].textContent = ethers.formatEther(a.fundedAmount - a.releasedAmount) + " ETH";
    els["d-deadline"].textContent = new Date(Number(a.deadline) * 1000).toLocaleString();
    const cd = formatCountdown(Number(a.deadline));
    els["d-countdown"].textContent = cd.text;
    els["d-countdown"].className = "countdown " + cd.cls;
    els["d-countdown"].dataset.deadline = String(a.deadline);
    els["d-status"].textContent = STATUS_LABELS[Number(a.status)];
    els["d-status"].className = "status-chip " + STATUS_CLASS[Number(a.status)];

    els["fund-btn"].dataset.value = a.totalValue.toString();
    els["fund-btn"].dataset.id = id;
    els["fund-btn"].disabled = Number(a.status) !== 0; // only when Created
    els["claim-refund-btn"].dataset.id = id;

    const milestones = await escrowContract.getMilestones(id);
    const mbody = document.getElementById("milestone-table-body");
    mbody.innerHTML = "";
    milestones.forEach((m, i) => {
      const payout = (a.totalValue * BigInt(m.shareBps)) / 10000n;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i}</td>
        <td>${m.description}</td>
        <td>${Number(m.shareBps) / 100}%</td>
        <td>${ethers.formatEther(payout)} ETH</td>
        <td>${m.reported ? "✔" : "—"}</td>
        <td>${m.verified ? "✔" : "—"}</td>
        <td class="milestone-actions"></td>
      `;
      const actionCell = tr.querySelector(".milestone-actions");
      if (!m.verified) {
        if (!m.reported) {
          const btn = document.createElement("button");
          btn.className = "small-btn";
          btn.textContent = "Report (Carrier)";
          btn.addEventListener("click", () => reportMilestone(id, i));
          actionCell.appendChild(btn);
        } else {
          const btn = document.createElement("button");
          btn.className = "small-btn";
          btn.textContent = "Verify & Pay (Shipper)";
          btn.addEventListener("click", () => verifyMilestone(id, i));
          actionCell.appendChild(btn);
        }
      }
      mbody.appendChild(tr);
    });
  } catch (err) {
    setStatus(els["agreement-action-status"], parseErr(err), "err");
  }
}

els["fund-btn"].addEventListener("click", async () => {
  if (!requireContracts()) return;
  const id = els["fund-btn"].dataset.id;
  const value = els["fund-btn"].dataset.value;
  try {
    setStatus(els["agreement-action-status"], "Sending funds into escrow…");
    const tx = await escrowContract.fundAgreement(id, { value });
    await tx.wait();
    setStatus(els["agreement-action-status"], `Funded. Tx: ${tx.hash}`, "ok");
    loadAgreementDetail();
  } catch (err) {
    setStatus(els["agreement-action-status"], parseErr(err), "err");
  }
});

els["claim-refund-btn"].addEventListener("click", async () => {
  if (!requireContracts()) return;
  const id = els["claim-refund-btn"].dataset.id;
  try {
    setStatus(els["agreement-action-status"], "Claiming refund of remaining escrow balance…");
    const tx = await escrowContract.claimRefund(id);
    await tx.wait();
    setStatus(els["agreement-action-status"], `Refund issued. Tx: ${tx.hash}`, "ok");
    loadAgreementDetail();
  } catch (err) {
    setStatus(els["agreement-action-status"], parseErr(err), "err");
  }
});

async function reportMilestone(id, index) {
  try {
    setStatus(els["agreement-action-status"], `Reporting milestone ${index}…`);
    const tx = await escrowContract.reportMilestone(id, index);
    await tx.wait();
    setStatus(els["agreement-action-status"], `Milestone ${index} reported. Tx: ${tx.hash}`, "ok");
    loadAgreementDetail();
  } catch (err) {
    setStatus(els["agreement-action-status"], parseErr(err), "err");
  }
}

async function verifyMilestone(id, index) {
  try {
    setStatus(els["agreement-action-status"], `Verifying milestone ${index} and releasing payout…`);
    const tx = await escrowContract.verifyMilestone(id, index);
    await tx.wait();
    setStatus(els["agreement-action-status"], `Milestone ${index} verified & paid. Carrier earned 1 CRP. Tx: ${tx.hash}`, "ok");
    loadAgreementDetail();
    refreshCrpBalance(); // in case the connected wallet is the carrier who just earned CRP
  } catch (err) {
    setStatus(els["agreement-action-status"], parseErr(err), "err");
  }
}

// ---------------------------------------------------------------
// Ledger — event history
// ---------------------------------------------------------------
els["refresh-ledger-btn"].addEventListener("click", loadLedger);

async function loadLedger() {
  if (!escrowContract) return;
  const tbody = document.querySelector("#ledger-table tbody");
  tbody.innerHTML = "";
  try {
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 9000); // RPC eth_getLogs range limit
    const events = await escrowContract.queryFilter("*", fromBlock, "latest");
    els["ledger-empty"].style.display = events.length === 0 ? "block" : "none";
    events.sort((a, b) => b.blockNumber - a.blockNumber);
    for (const ev of events) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${ev.blockNumber}</td><td>${ev.fragment ? ev.fragment.name : "?"}</td><td class="mono">${formatEventArgs(ev)}</td>`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error(err);
  }
}

function formatEventArgs(ev) {
  if (!ev.args || !ev.fragment) return "";
  const parts = [];
  ev.fragment.inputs.forEach((input, i) => {
    const v = ev.args[i];
    parts.push(`${input.name}=${typeof v === "bigint" ? v.toString() : v}`);
  });
  return parts.join(", ");
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function requireContracts() {
  if (!escrowContract || !tokenContract) {
    alert("Connect your wallet and save contract addresses under the Setup tab first.");
    document.querySelector('[data-tab="setup"]').click();
    return false;
  }
  return true;
}

function setStatus(el, msg, cls) {
  el.textContent = msg;
  el.className = "status-line" + (cls ? " " + cls : "");
}

function parseErr(err) {
  return err?.reason || err?.shortMessage || err?.message || String(err);
}

// ---------------------------------------------------------------
// Carrier Reputation Lookup — check ANY wallet's CRP score
// ---------------------------------------------------------------
els["rep-lookup-btn"].addEventListener("click", lookupReputation);

async function lookupReputation() {
  const addr = els["rep-lookup-input"].value.trim();
  if (!ethers.isAddress(addr)) {
    setStatus(els["rep-lookup-status"], "Enter a valid wallet address.", "err");
    return;
  }
  if (!tokenContract) {
    // Reputation lookup only needs a read-only connection to the token contract,
    // so fall back to a plain provider if the wallet isn't connected yet.
    if (!provider) {
      setStatus(els["rep-lookup-status"], "Connect a wallet first (Login tab) so we have a network to read from.", "err");
      return;
    }
  }
  try {
    setStatus(els["rep-lookup-status"], "Looking up on-chain balance…");
    const contractToUse = tokenContract || new ethers.Contract(
      localStorage.getItem("manifest_token_addr"), tokenAbi, provider
    );
    const bal = await contractToUse.balanceOf(addr);
    els["rep-badge-value"].textContent = formatCrp(bal);
    els["rep-detail-addr"].textContent = addr;
    els["rep-lookup-result"].classList.remove("hidden");
    setStatus(els["rep-lookup-status"], "", "");
  } catch (err) {
    setStatus(els["rep-lookup-status"], parseErr(err), "err");
  }
}

// ---------------------------------------------------------------
// Export Transaction Ledger to CSV
// ---------------------------------------------------------------
els["export-ledger-btn"].addEventListener("click", exportLedgerCsv);

function exportLedgerCsv() {
  const rows = [...document.querySelectorAll("#ledger-table tbody tr")];
  if (rows.length === 0) {
    setStatus(els["ledger-empty"], "Nothing to export — refresh the ledger first.");
    return;
  }
  const csvLines = ["Block,Event,Details"];
  rows.forEach(tr => {
    const cells = [...tr.children].map(td => `"${td.textContent.replace(/"/g, '""')}"`);
    csvLines.push(cells.join(","));
  });
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `manifest-ledger-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
(async function init() {
  await loadAbis();
  if (localStorage.getItem("manifest_escrow_addr")) {
    setStatus(els["setup-status"], "Saved contract addresses loaded. Connect your wallet to continue.", "ok");
  }
})();

// Keep countdowns live without needing a manual refresh — cheap, no chain calls.
setInterval(() => {
  const dCd = els["d-countdown"];
  if (dCd && dCd.dataset.deadline) {
    const cd = formatCountdown(Number(dCd.dataset.deadline));
    dCd.textContent = cd.text;
    dCd.className = "countdown " + cd.cls;
  }
}, 30000);
