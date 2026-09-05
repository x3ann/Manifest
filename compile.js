const fs = require("fs");
const path = require("path");
const solc = require("solc");

function findImports(importPath) {
  try {
    let resolved;
    if (importPath.startsWith("@openzeppelin")) {
      resolved = path.join(__dirname, "node_modules", importPath);
    } else {
      resolved = path.join(__dirname, "contracts", importPath);
    }
    return { contents: fs.readFileSync(resolved, "utf8") };
  } catch (e) {
    return { error: "File not found: " + importPath };
  }
}

const files = ["LogisticsEscrow.sol", "CarrierReputationToken.sol"];
const sources = {};
for (const f of files) {
  sources[f] = { content: fs.readFileSync(path.join(__dirname, "contracts", f), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object"] },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

let hasError = false;
if (output.errors) {
  for (const err of output.errors) {
    console.log(err.severity.toUpperCase() + ":", err.formattedMessage);
    if (err.severity === "error") hasError = true;
  }
}

if (!hasError) {
  console.log("\n✅ Compilation successful\n");
  for (const file of Object.keys(output.contracts || {})) {
    for (const name of Object.keys(output.contracts[file])) {
      const bytecodeLen = output.contracts[file][name].evm.bytecode.object.length / 2;
      console.log(`  ${file}:${name} — bytecode size ${bytecodeLen} bytes`);
    }
  }
  fs.writeFileSync(path.join(__dirname, "build.json"), JSON.stringify(output.contracts, null, 2));
} else {
  process.exit(1);
}
