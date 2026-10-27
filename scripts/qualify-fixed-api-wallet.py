#!/usr/bin/env python3
"""Qualify current fixed APIs with a new wallet on an owned disposable fork.

Invoke through Ops' authenticated RPC wrapper. Only the Anvil started here is
funded/unpaused; no installed server, public-chain write or owner wallet is used.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import io
import json
import math
import os
import secrets
import re
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
POSTGRES = "postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15"

LOG_OPERATIONS = {
    "quote", "swap", "wallet", "unmatched", "/api/economic-quotes", "/api/tx-preparations",
    "/api/economic-estimates", "/api/protocol/config", "/api/protocol/facts", "/api/governance/helpers-facts",
    "/api/account/core-permit", "/api/account/token-permit", "/api/account/permit2", "/api/account/transaction-nonce",
    "/api/account/wallet-balances", "/api/account/token-balance", "/api/transaction/helpers-execution",
    "/api/transaction/token-approval-gas", "/api/transaction/permit2-approval-gas", "/api/transaction/receipt",
    "/api/transaction/wait/head", "/api/transaction/wait/transaction", "/api/transaction/wait/receipt", "/api/transaction/fees",
    "/api/quotes/trade/stream", "/api/quotes/intent/stream", "/api/quotes/universal-exact-input",
    "/api/quotes/basket-preview", "/api/quotes/routes/stream", "/api/quotes/routes", "/api/pools/snapshot",
}
LOG_ENUMS = {
    "outcome": {"started", "succeeded", "failed", "cancelled", "submitted", "reverted", "unconfirmed", "requested"},
    "stage": {"quote", "balance", "network", "authorization", "preparation", "simulation", "submission", "confirmation"},
    "walletStep": {"approval", "signature", "transaction"},
    "reason": {"wallet_rejected", "rpc_error", "contract_reverted", "wrong_chain", "unknown"},
    "direction": {"issue", "redeem"}, "route": {"basket", "token"}, "inputMode": {"exact-in", "exact-out"},
    "strategy": {"core", "market", "universal"}, "side": {"buy", "sell"},
    "method": {"GET", "HEAD", "POST", "OPTIONS", "other"},
    "operationKind": {"quoter", "transaction-preparation", "fast-estimator"},
    "operationPhase": {"lookup", "current-state-search", "selected-plan-replay", "advisory-estimate"},
    "resultSource": {"stored-quote", "search", "refresh", "prepared-transaction", "fast-estimate"},
    "exceptionType": {"TimeoutError", "RpcTimeout", "ValueError", "TypeError", "RuntimeError", "QuoteFailure",
        "Web3RPCError", "InvalidPreview", "SdkWorkerError", "CancelledError", "SnapshotChanged",
        "ClientConnectorError", "ClientResponseError", "HTTPStatusError", "ContractLogicError"},
    "context": {"core-permit", "token-permit", "permit2-context", "helpers-execution", "protocol-facts",
        "helpers-router-facts", "wallet-balances", "token-approval-gas", "permit2-approval-gas"},
}
LOG_CODES = {"rpc-rate-limit", "rpc-timeout", "rpc-unavailable", "rpc-access-denied", "quote-timeout",
    "quote-no-route", "quote-insufficient-liquidity", "quote-contract-reverted", "quote-unavailable",
    "quote-service-unavailable", "quote-stream-interrupted", "quote-invalid-input", "quote-request-limit",
    "insufficient-protocol-supply", "issuance-cap-exceeded", "redemption-supply-exceeded",
    "insufficient-reserve-balance", "insufficient-recovery-shares", "redemption-capacity-exceeded"}


def projected_container_logs(raw: str, database_password: str):
    """Retain every failed operation through a closed, public-field projection.

    Provider prose, stack traces, params, calldata, signatures and arbitrary
    strings never enter either artifact. No record changes run admission.
    """
    failures, startup = [], []
    lines = raw.replace(database_password, "[redacted]").splitlines()
    startup_markers = {
        "Started server process": "api-process-started",
        "Waiting for application startup": "api-startup-waiting",
        "Application startup complete": "api-startup-complete",
        "Uvicorn running on": "api-listener-started",
        "Application shutdown complete": "api-shutdown-complete",
        "database system is ready to accept connections": "postgres-ready",
        "PostgreSQL init process complete": "postgres-initialized",
        "database system is shut down": "postgres-shutdown-complete",
    }
    for line in lines:
        for marker, event in startup_markers.items():
            if marker in line:
                startup.append({"event": event})
                break
        try:
            record, _ = json.JSONDecoder().raw_decode(line[line.index("{"):])
        except (ValueError, TypeError):
            continue
        if not isinstance(record, dict):
            continue
        event = record.get("event")
        status = record.get("statusCode")
        if record.get("msg") == "request completed" and type(status) is int and 400 <= status <= 599:
            event = "http_failure"
        elif record.get("msg") == "unhandled route failure":
            event = "unhandled_route_failure"
        elif event == "quote_failure":
            pass
        elif event in ("quote_outcome", "client_diagnostic") and record.get("outcome") in ("failed", "cancelled", "reverted", "unconfirmed"):
            pass
        else:
            continue
        safe = {"event": event}
        operation = record.get("operation")
        if isinstance(operation, str) and operation in LOG_OPERATIONS:
            safe["operation"] = operation
        for key, values in LOG_ENUMS.items():
            if isinstance(record.get(key), str) and record[key] in values:
                safe[key] = record[key]
        for key in ("code", "errorClassification"):
            value = record.get(key)
            if isinstance(value, str) and (value in LOG_CODES or value in {name + "-unavailable" for name in LOG_ENUMS["context"]}):
                safe[key] = value
        for key in ("requestId", "correlationId", "attemptId", "diagnosticRequestId", "quoteId", "workId"):
            value = record.get(key)
            if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", value, re.I):
                safe[key] = value
        for key in ("release", "blockHash", "transactionHash", "errorSelector"):
            value = record.get(key)
            pattern = r"[0-9a-f]{40}" if key == "release" else r"0x[0-9a-f]{8}" if key == "errorSelector" else r"0x[0-9a-f]{64}"
            if isinstance(value, str) and re.fullmatch(pattern, value, re.I):
                safe[key] = value
        for key in ("time", "pid", "statusCode", "errorCode", "durationMs", "chainId", "assetCount"):
            value = record.get(key)
            if type(value) in (int, float) and -(2**53 - 1) <= value <= 2**53 - 1 and math.isfinite(value):
                safe[key] = value
        for key in ("quotedInput", "inputMaximum", "outputMinimum", "quotedOutput", "blockNumber", "amount"):
            value = record.get(key)
            if isinstance(value, str) and re.fullmatch(r"[0-9]{1,78}", value) and int(value) < 2**256:
                safe[key] = value
        diagnostics = record.get("diagnostics")
        if isinstance(diagnostics, dict):
            public_rpc = {}
            for key, values in {
                "failureType": {"rpc-error", "backend-deadline", "provider-timeout", "http-error", "transport-error"},
                "rpcMethod": {"eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash",
                    "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_gasPrice",
                    "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getTransactionCount",
                    "eth_getBalance", "eth_getCode", "eth_getLogs"},
                "stage": {"chain-head", "block-read", "contract-read", "gas-estimation", "priority-fee", "gas-price",
                    "receipt-read", "transaction-read", "nonce-read", "balance-read", "code-read", "event-read",
                    "helpers-simulation", "helpers-gas-estimation", "rpc-request"},
            }.items():
                if isinstance(diagnostics.get(key), str) and diagnostics[key] in values:
                    public_rpc[key] = diagnostics[key]
            for key in ("elapsedMs", "httpStatus", "upstreamErrorCode"):
                value = diagnostics.get(key)
                if type(value) in (int, float) and -(2**53 - 1) <= value <= 2**53 - 1 and math.isfinite(value):
                    public_rpc[key] = value
            selector = diagnostics.get("errorSelector")
            if isinstance(selector, str) and re.fullmatch(r"0x[0-9a-f]{8}", selector, re.I):
                public_rpc["errorSelector"] = selector
            if public_rpc:
                safe["diagnostics"] = public_rpc
        failures.append(safe)
    return {"failedEvents": failures, "startupTail": startup[-100:], "sourceLineCount": len(lines)}


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def rpc(url: str, method: str, params: list):
    request = urllib.request.Request(url, json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params,
    }).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        value = json.load(response)
    if "error" in value:
        raise RuntimeError(f"{method}: {value['error']}")
    return value["result"]


def wait_http(url: str) -> None:
    for _ in range(120):
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.5)
    raise RuntimeError(f"Fixture did not answer: {url}")


def private_env(path: Path, values: dict[str, str]) -> None:
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as stream:
        stream.write("".join(f"{key}={value}\n" for key, value in values.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-image", required=True)
    parser.add_argument("--contracts-json", required=True, type=Path)
    parser.add_argument("--funding-json", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--fork-block", type=int, help="Use this upstream block; omission selects finalized.")
    parser.add_argument("--helpers-root", type=Path,
                        help="Deploy pending Helpers on this run's owned Anvil from existing compiled artifacts.")
    parser.add_argument("--backend-root", type=Path,
                        help="Backend checkout containing the existing universal_fork deployment fixture.")
    parser.add_argument("--platform", default="linux/amd64")
    parser.add_argument("--docker-command", default=("/Applications/Docker.app/Contents/Resources/bin/docker"
                        if sys.platform == "darwin" else "docker"))
    parser.add_argument("--test-file", action="append", dest="test_files",
                        help="Explicit focused test selection; omission runs every existing wallet profile file plus Quoter integration.")
    args = parser.parse_args()
    def stop_owned_fixture(signum, _frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, stop_owned_fixture)
    output = (args.output_dir or Path(tempfile.mkdtemp(prefix="cybergold-wallet-"))).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    work = Path(tempfile.mkdtemp(prefix="source-", dir=output))
    suffix = secrets.token_hex(6)
    network = f"cybergold-wallet-{suffix}"
    pg, api, api2 = f"{network}-pg", f"{network}-api", f"{network}-secondary-api"
    processes, containers = [], []
    network_created = False
    evidence = {"observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "result": "running", "stage": "source", "transactions": []}
    environment = {key: os.environ[key] for key in
                   ("PATH", "HOME", "TMPDIR", "DISPLAY", "XAUTHORITY", "CI") if key in os.environ}
    environment["NEXT_TELEMETRY_DISABLED"] = "1"

    def persist_evidence():
        try:
            temporary = output / "qualification.json.tmp"
            temporary.write_text(json.dumps(evidence, indent=2) + "\n")
            temporary.replace(output / "qualification.json")
        except OSError:
            # Evidence is best effort; it must not replace the original failure
            # or prevent cleanup of the owned fixture.
            print("Qualification evidence could not be written", flush=True)

    def checkpoint(stage):
        evidence["stage"] = stage
        persist_evidence()

    def docker(*values: str) -> str:
        return subprocess.check_output([args.docker_command, *values], text=True).strip()

    def start(command, name, cwd=work):
        with (output / f"{name}.log").open("w") as stream:
            process = subprocess.Popen(command, cwd=cwd, env=environment,
                                       stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        processes.append(process)
        return process

    def run(command, name, timeout=600):
        print(f"Starting {name}", flush=True)
        process = start(command, name)
        if process.wait(timeout=timeout):
            raise RuntimeError(f"{name} failed; see {output / (name + '.log')}")
        print(f"PASS: {name}", flush=True)

    try:
        source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=APP, text=True).strip()
        evidence["frontendCommit"] = source_commit
        with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(["git", "archive", "HEAD"], cwd=APP))) as archive:
            archive.extractall(work, filter="data")
        (work / "node_modules").symlink_to((APP / "node_modules").resolve(), target_is_directory=True)
        checkpoint("fork")
        anchor_selector = hex(args.fork_block) if args.fork_block is not None else "finalized"
        anchor = rpc(os.environ["MAINNET_RPC_URL"], "eth_getBlockByNumber", [anchor_selector, False])
        block = int(anchor["number"], 16)
        evidence.update({"chainId": 31338, "forkBlock": block, "forkBlockHash": anchor["hash"],
                         "forkAnchorSelection": "explicit-block" if args.fork_block is not None else "finalized"})
        persist_evidence()
        fork_port, api_port, second_api_port, frontend_port = free_port(), free_port(), free_port(), free_port()
        fork = f"http://127.0.0.1:{fork_port}"
        start(["anvil", "--fork-url", os.environ["MAINNET_RPC_URL"], "--fork-block-number", str(block),
               "--chain-id", "31338", "--port", str(fork_port), "--host", "0.0.0.0", "--silent"], "anvil")
        for _ in range(150):
            try:
                if rpc(fork, "eth_chainId", []) == "0x7a6a":
                    break
            except OSError:
                time.sleep(0.2)
        else:
            raise RuntimeError("Owned Anvil did not answer")
        wallet = json.loads(subprocess.check_output(["node", "--input-type=module", "-e",
            "import {generateMnemonic,mnemonicToAccount,english} from 'viem/accounts';"
            "const mnemonic=generateMnemonic(english);"
            "console.log(JSON.stringify({mnemonic,address:mnemonicToAccount(mnemonic).address}));"], cwd=work, text=True))
        password = secrets.token_urlsafe(24)
        address = wallet["address"]
        checkpoint("funding")
        rpc(fork, "anvil_setBalance", [address, hex(100 * 10**18)])
        funding = json.loads(args.funding_json.read_text())["fork"]["funding"]["tokenFunding"]
        for symbol, token, holder, amount in zip(funding["symbols"], funding["addresses"], funding["holders"], funding["perAddr"]):
            if symbol.upper() == "USDC":
                decimals = int(subprocess.check_output(["cast", "call", "--rpc-url", fork, token,
                    "decimals()(uint8)"], text=True).strip())
                planned = json.loads(subprocess.check_output(["node", "--input-type=module", "-e",
                    "import {ownedUsdcStartupFunding} from './tests/trading/ownedWalletFunding.ts';"
                    "console.log(JSON.stringify(ownedUsdcStartupFunding(process.argv[1],Number(process.argv[2]))));",
                    "--", amount, str(decimals)], cwd=work, env=environment, text=True))
                amount = planned["transferAmount"]
                evidence["usdcStartupFunding"] = planned
            rpc(fork, "anvil_setBalance", [holder, hex(10**18)])
            rpc(fork, "anvil_impersonateAccount", [holder])
            try:
                run(["cast", "send", "--rpc-url", fork, "--from", holder, "--unlocked", token,
                     "transfer(address,uint256)", address, amount], f"fund-{symbol}", timeout=120)
            finally:
                rpc(fork, "anvil_stopImpersonatingAccount", [holder])
        contracts = json.loads(args.contracts_json.read_text())
        safe = contracts["safe"]["safe"]
        core = contracts["protocol"]["coreDiamond"]
        checkpoint("core-preparation")
        if subprocess.check_output(["cast", "call", "--rpc-url", fork, core, "paused()(bool)"], text=True).strip() == "true":
            rpc(fork, "anvil_setBalance", [safe, hex(10**18)])
            rpc(fork, "anvil_impersonateAccount", [safe])
            try:
                run(["cast", "send", "--rpc-url", fork, "--from", safe, "--unlocked",
                     core, "unpause()"], "unpause-owned-Core", timeout=120)
            finally:
                rpc(fork, "anvil_stopImpersonatingAccount", [safe])
        if args.helpers_root is not None or args.backend_root is not None:
            checkpoint("helpers-preparation")
            backend_root = (args.backend_root or APP.parent / "cybergold-backend").resolve()
            helpers_root = (args.helpers_root or APP.parent / "cybergold-helpers-universal-exact-in").resolve()
            # The existing qualification producer deploys exclusively to the
            # Anvil URL created above. Source identities are observations.
            sys.path.insert(0, str(backend_root / "python-candidate/src"))
            sys.path.insert(0, str(backend_root / "python-candidate/tests/qualification"))
            import universal_fork as helpers_fixture
            helpers_fixture.HELPERS = helpers_root
            helpers_fixture.CORE = core
            artifacts = {}
            original_artifact = helpers_fixture.artifact

            def observed_artifact(name):
                value = original_artifact(name)
                path = helpers_root / "out" / (name + ".sol") / (name + ".json")
                artifacts[name] = {"artifactSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "creationTemplateSha256": hashlib.sha256(value["bytecode"]["object"].encode()).hexdigest()}
                return value

            helpers_fixture.artifact = observed_artifact
            local_web3 = helpers_fixture.Web3(helpers_fixture.Web3.HTTPProvider(fork))
            helpers, routing_adapter = helpers_fixture.deploy_helpers(local_web3, local_web3.eth.accounts[0])
            contracts["helpers"] = {**contracts["helpers"], "diamond": helpers.address,
                                     "uniswapAdapter": routing_adapter, "routingAdapter": routing_adapter}
            evidence["helpersDeployment"] = {"source": "owned-local-pending-source", "helpers": helpers.address,
                "routingAdapter": routing_adapter, "artifacts": artifacts,
                "generatedAbiSha256": hashlib.sha256((helpers_root / "generated/abi/HelpersDiamond.json").read_bytes()).hexdigest()}
            for label, source in (("backend", backend_root), ("helpers", helpers_root)):
                try:
                    evidence[label + "Source"] = {"commit": subprocess.check_output(["git", "rev-parse", "HEAD"],
                        cwd=source, text=True, stderr=subprocess.DEVNULL).strip(),
                        "dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=source,
                            text=True, stderr=subprocess.DEVNULL).strip())}
                except (OSError, subprocess.CalledProcessError):
                    pass
        settings = {
            "NEXT_PUBLIC_CHAIN_ID": "31338", "NEXT_PUBLIC_CHAIN_NAME": "CyberGold Disposable Wallet Fork",
            "NEXT_PUBLIC_APP_ORIGIN": f"http://127.0.0.1:{frontend_port}", "NEXT_PUBLIC_WALLET_RPC_URL": fork,
            "CYBERGOLD_BACKEND_URL": f"http://127.0.0.1:{api_port}", "NEXT_PUBLIC_FORK_FAUCET_ENABLED": "0",
        }
        backend_settings = {
            "NEXT_PUBLIC_CORE_DIAMOND_ADDRESS": contracts["protocol"]["coreDiamond"],
            "NEXT_PUBLIC_HELPERS_DIAMOND_ADDRESS": contracts["helpers"]["diamond"],
            "CYBERGOLD_UNISWAP_ROUTING_ADAPTER_ADDRESS": contracts["helpers"].get("routingAdapter") or contracts["helpers"].get("uniswapAdapter"),
        }
        environment.update(settings)
        environment.update({"PLAYWRIGHT_BASE_URL": settings["NEXT_PUBLIC_APP_ORIGIN"], "PLAYWRIGHT_EXTERNAL_SERVER": "1",
                            "SYNPRESS_WALLET_SEED_PHRASE": wallet["mnemonic"], "SYNPRESS_WALLET_PASSWORD": password,
                            "TRADE_REGRESSION_OUTPUT": str(output / "regression-execution.json"),
                            "TRADE_REGRESSION_UI_OUTPUT": str(output / "regression-ui.json"),
                            "TRADE_REGRESSION_UI_FIXTURE_OUTPUT": str(output / "wallet-fixture-ui.json"),
                            "TRADE_REGRESSION_INDEPENDENT_FIXTURE_OUTPUT": str(output / "wallet-fixture-independent.json"),
                            "TRADE_REGRESSION_SECOND_API_URL": f"http://127.0.0.1:{second_api_port}",
                            "TRADE_REGRESSION_QUOTER_INTEGRATION_OUTPUT": str(output / "quoter-integration.json"),
                            "TRADE_REGRESSION_MODE": "fork-execution", "TRADE_REGRESSION_TARGET": os.environ.get("TRADE_REGRESSION_TARGET", "mainnet")})
        database_password = secrets.token_urlsafe(24)
        private_env(work / "database.env", {"POSTGRES_USER": "fixture", "POSTGRES_PASSWORD": database_password, "POSTGRES_DB": "fixture"})
        backend_rpc = f"http://host.docker.internal:{fork_port}"
        private_env(work / "backend.env", {**settings, **backend_settings, "CYBERGOLD_BACKEND_URL": "http://127.0.0.1:3000",
                    "DATABASE_URL": f"postgresql://fixture:{database_password}@pg:5432/fixture",
                    "NEXT_PUBLIC_RPC_URL": backend_rpc, "RPC_URL": backend_rpc, "HOST": "0.0.0.0", "PORT": "3000"})
        checkpoint("backend")
        docker("network", "create", network)
        network_created = True
        containers.append(pg)
        docker("run", "-d", "--name", pg, "--network", network, "--network-alias", "pg",
               "--tmpfs", "/var/lib/postgresql:rw,nosuid,nodev,size=384m",
               "--env-file", str(work / "database.env"), POSTGRES)
        api_instances = []
        for name, port in ((api, api_port), (api2, second_api_port)):
            containers.append(name)
            identifier = docker("run", "-d", "--platform", args.platform, "--name", name, "--network", network,
                   "--add-host", "host.docker.internal:host-gateway", "--env-file", str(work / "backend.env"),
                   "-p", f"127.0.0.1:{port}:3000", args.backend_image)
            api_instances.append({"name": name, "containerId": identifier})
        evidence["apiInstances"] = api_instances
        evidence["backendPlatform"] = args.platform
        wait_http(f"http://127.0.0.1:{api_port}/api/transaction/wait/head")
        wait_http(f"http://127.0.0.1:{second_api_port}/api/transaction/wait/head")
        # This new empty database uses the image's existing canonical schema,
        # including the retained sync-state table read by protocol facts.
        run([args.docker_command, "exec", api, "python", "-m", "alembic", "-c", "schema/alembic.ini", "upgrade", "head"],
            "owned-database-schema", timeout=120)
        checkpoint("frontend")
        run(["node", "node_modules/next/dist/bin/next", "build", "--webpack"], "frontend-build")
        start(["node", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", str(frontend_port)], "frontend")
        wait_http(settings["NEXT_PUBLIC_APP_ORIGIN"] + "/en")
        (work / "playwright.wallet.config.ts").write_text(
            "import {defineConfig,devices} from '@playwright/test';export default defineConfig({"
            "testDir:'./tests/metamask',timeout:120000,workers:1,fullyParallel:false,retries:0,"
            f"reporter:[['list'],['json',{{outputFile:{json.dumps(str(output / 'wallet-results.json'))}}}]],"
            f"use:{{baseURL:{json.dumps(settings['NEXT_PUBLIC_APP_ORIGIN'])},trace:'off'}},"
            "projects:[{name:'metamask',use:{...devices['Desktop Chrome'],browserName:'chromium',channel:'chromium',headless:false}}]});\n")
        test_paths = ["scripts/qualify-fixed-api-wallet.py", "scripts/cache-metamask-wallet.mjs", "wallet-setup/metamask.setup.ts",
                      "tests/metamask/testWithMetaMask.ts", "tests/metamask/fixed-api-roundtrips.spec.ts",
                      "tests/metamask/quoter-integration.spec.ts",
                      "tests/metamask/wallet-session.spec.ts", "tests/metamask/wallet-ui.ts", "tests/metamask/token-flows/helpers.ts",
                      "tests/metamask/regression-execution.spec.ts", "tests/trading/scenarios.ts", "tests/trading/matrix.ts", "tests/trading/providerEvidence.ts", "tests/trading/planAssertions.ts", "tests/trading/quoteObservation.ts", "tests/trading/regression.ts", "tests/trading/runnerDiagnostics.ts", "tests/trading/walletExecution.ts",
                      "tests/trading/uiReceipt.ts", "tests/trading/uiEconomics.ts", "tests/trading/uiQuoteCapture.ts", "tests/trading/uiGas.ts", "tests/trading/uiDiagnostics.ts", "tests/trading/sandboxFunding.ts", "tests/trading/ownedWalletFunding.ts"]
        try:
            image_environment = json.loads(docker("image", "inspect", args.backend_image, "--format", "{{json .Config.Env}}"))
            backend_commit = next((value.split("=", 1)[1] for value in image_environment if value.startswith("CYBERGOLD_BACKEND_COMMIT=")), None)
            if backend_commit and re.fullmatch(r"[0-9a-f]{40}", backend_commit):
                evidence["backendImageCommit"] = backend_commit
            image_id = docker("image", "inspect", args.backend_image, "--format", "{{.Id}}")
            if re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
                evidence["backendImageId"] = image_id
        except (OSError, subprocess.CalledProcessError, ValueError):
            pass  # Optional image observations are not fixture requirements.
        try:
            runtime_commit = docker("exec", api, "python", "-c",
                "import os; print(os.environ.get('CYBERGOLD_BACKEND_COMMIT', ''))").strip()
            if re.fullmatch(r"[0-9a-f]{40}", runtime_commit):
                evidence["backendRuntimeCommit"] = runtime_commit
        except (OSError, subprocess.CalledProcessError):
            pass  # Mounted-runtime identity is an observation, not admission.
        evidence.update({
            "testInputSha256": {path: hashlib.sha256((work / path).read_bytes()).hexdigest() for path in test_paths},
            "contractsSha256": hashlib.sha256(args.contracts_json.read_bytes()).hexdigest(),
            "fundingSha256": hashlib.sha256(args.funding_json.read_bytes()).hexdigest(),
            "scope": "24 exact-input UI-selected funded paths, rejection/session cases and integrated two-browser Quoter verification; real Python APIs/native PG18/production Next.js, actual wallet/receipt economics with gas separate. Only browser B's economic/preparation paths use unchanged API2 responses; other requests retain normal App/API1 forwarding. No generated quote or receipt responses.",
            "wallet": "New disposable seed/profile; no owner wallet or B2B/public-chain write",
        })
        selected_files = args.test_files or ["fixed-api-roundtrips.spec.ts", "wallet-session.spec.ts",
                                            "regression-execution.spec.ts", "quoter-integration.spec.ts"]
        evidence["testSelection"] = {"mode": "focused" if args.test_files else "full-existing-profile-plus-quoter-integration",
                                     "files": selected_files}
        if args.test_files:
            evidence["scope"] = "Explicit focused wallet files listed in testSelection; only their actual results are claimed. The existing 24-journey matrix remains available in the default full profile."
        evidence["quoterIntegrationScope"] = "Real MetaMask browser A and independent anonymous browser B; only economic-quotes/tx-preparations are bridged unchanged to API2, with other requests retaining normal App/API1 forwarding; live economic/preparation APIs and actual receipt checks. Existing wallet-capability alternatives retain their separately scoped fixture evidence."
        checkpoint("wallet-cache")
        run(["node", "scripts/cache-metamask-wallet.mjs"], "new-wallet-cache", timeout=300)
        start_block = int(rpc(fork, "eth_blockNumber", []), 16)
        checkpoint("wallet-tests")
        run(["node", "node_modules/@playwright/test/cli.js", "test", "--config", "playwright.wallet.config.ts",
             *selected_files], "wallet-tests", timeout=4800)
        checkpoint("receipts")
        for height in range(start_block + 1, int(rpc(fork, "eth_blockNumber", []), 16) + 1):
            for transaction in rpc(fork, "eth_getBlockByNumber", [hex(height), True])["transactions"]:
                if transaction["from"].lower() == address.lower():
                    receipt = rpc(fork, "eth_getTransactionReceipt", [transaction["hash"]])
                    evidence["transactions"].append({"hash": transaction["hash"], "to": transaction["to"],
                                         "selector": transaction["input"][:10], "status": receipt["status"], "blockNumber": height})
        evidence["result"] = "pass"
    except BaseException as error:
        evidence["result"] = "fail"
        evidence["errorClass"] = ("timeout" if isinstance(error, subprocess.TimeoutExpired)
            else "interrupted" if isinstance(error, (SystemExit, KeyboardInterrupt))
            else "command-failed" if isinstance(error, subprocess.CalledProcessError)
            else "system-error" if isinstance(error, OSError)
            else "operation-failed" if isinstance(error, RuntimeError) else "unexpected-error")
        raise
    finally:
        cleanup = {key: "complete" for key in ("processes", "containers", "network", "source")}
        for process in reversed(processes):
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=15)
            except ProcessLookupError:
                pass
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                except OSError:
                    cleanup["processes"] = "failed"
            except OSError:
                cleanup["processes"] = "failed"
        for name in reversed(containers):
            try:
                captured = subprocess.run([args.docker_command, "logs", name], stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, check=False)
                projected = projected_container_logs(captured.stdout, database_password)
                failures_path, startup_path = output / f"{name}-failures.jsonl", output / f"{name}.log"
                failures_path.write_text("".join(json.dumps(row) + "\n" for row in projected["failedEvents"]))
                startup_path.write_text("".join(json.dumps(row) + "\n" for row in projected["startupTail"]))
                evidence.setdefault("containerLogEvidence", []).append({"container": name,
                    "sourceLineCount": projected["sourceLineCount"], "failedEventCount": len(projected["failedEvents"]),
                    "startupEventCount": len(projected["startupTail"]), "captureExitCode": captured.returncode,
                    "failuresFile": failures_path.name, "startupFile": startup_path.name})
            except Exception:
                # Log capture/projection is best effort and cannot skip removal.
                evidence.setdefault("containerLogEvidence", []).append({"container": name, "result": "unavailable"})
            try:
                if subprocess.run([args.docker_command, "rm", "-f", "-v", name], stdout=subprocess.DEVNULL, check=False).returncode:
                    cleanup["containers"] = "failed"
            except OSError:
                cleanup["containers"] = "failed"
        if network_created:
            try:
                if subprocess.run([args.docker_command, "network", "rm", network], stdout=subprocess.DEVNULL, check=False).returncode:
                    cleanup["network"] = "failed"
            except OSError:
                cleanup["network"] = "failed"
        try:
            shutil.rmtree(work)
        except OSError:
            cleanup["source"] = "failed"
        evidence["cleanup"] = cleanup
        evidence["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        persist_evidence()
    print(f"PASS: fixed-API wallet qualification completed; evidence: {output / 'qualification.json'}", flush=True)


if __name__ == "__main__":
    main()
