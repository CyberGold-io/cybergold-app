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
import os
import secrets
import re
import shutil
import signal
import socket
import subprocess
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
POSTGRES = "postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15"


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


def docker(*args: str) -> str:
    return subprocess.check_output(["docker", *args], text=True).strip()


def private_env(path: Path, values: dict[str, str]) -> None:
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as stream:
        stream.write("".join(f"{key}={value}\n" for key, value in values.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-image", required=True)
    parser.add_argument("--contracts-json", required=True, type=Path)
    parser.add_argument("--funding-json", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    def stop_owned_fixture(signum, _frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, stop_owned_fixture)
    output = (args.output_dir or Path(tempfile.mkdtemp(prefix="cybergold-wallet-"))).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    work = Path(tempfile.mkdtemp(prefix="source-", dir=output))
    suffix = secrets.token_hex(6)
    network = f"cybergold-wallet-{suffix}"
    pg, api = f"{network}-pg", f"{network}-api"
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
        anchor = rpc(os.environ["MAINNET_RPC_URL"], "eth_getBlockByNumber", ["finalized", False])
        block = int(anchor["number"], 16)
        evidence.update({"chainId": 31338, "forkBlock": block, "forkBlockHash": anchor["hash"]})
        persist_evidence()
        fork_port, api_port, frontend_port = free_port(), free_port(), free_port()
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
        settings = {
            "NEXT_PUBLIC_CHAIN_ID": "31338", "NEXT_PUBLIC_CHAIN_NAME": "CyberGold Disposable Wallet Fork",
            "NEXT_PUBLIC_APP_ORIGIN": f"http://127.0.0.1:{frontend_port}", "NEXT_PUBLIC_WALLET_RPC_URL": fork,
            "CYBERGOLD_BACKEND_URL": f"http://127.0.0.1:{api_port}", "NEXT_PUBLIC_FORK_FAUCET_ENABLED": "0",
        }
        backend_settings = {
            "NEXT_PUBLIC_CORE_DIAMOND_ADDRESS": contracts["protocol"]["coreDiamond"],
            "NEXT_PUBLIC_HELPERS_DIAMOND_ADDRESS": contracts["helpers"]["diamond"],
            "NEXT_PUBLIC_UNISWAP_QUOTER_ADDRESS": "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
            "NEXT_PUBLIC_UNISWAP_ADAPTER_ADDRESS": contracts["helpers"]["uniswapAdapter"],
        }
        environment.update(settings)
        environment.update({"PLAYWRIGHT_BASE_URL": settings["NEXT_PUBLIC_APP_ORIGIN"], "PLAYWRIGHT_EXTERNAL_SERVER": "1",
                            "SYNPRESS_WALLET_SEED_PHRASE": wallet["mnemonic"], "SYNPRESS_WALLET_PASSWORD": password,
                            "TRADE_REGRESSION_OUTPUT": str(output / "regression-execution.json"),
                            "TRADE_REGRESSION_UI_OUTPUT": str(output / "regression-ui.json"),
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
               "--env-file", str(work / "database.env"), POSTGRES)
        containers.append(api)
        docker("run", "-d", "--platform", "linux/amd64", "--name", api, "--network", network,
               "--add-host", "host.docker.internal:host-gateway", "--env-file", str(work / "backend.env"),
               "-p", f"127.0.0.1:{api_port}:3000", args.backend_image)
        wait_http(f"http://127.0.0.1:{api_port}/api/transaction/wait/head")
        # This new empty database uses the image's existing canonical schema,
        # including the retained sync-state table read by protocol facts.
        run(["docker", "exec", api, "python", "-m", "alembic", "-c", "schema/alembic.ini", "upgrade", "head"],
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
                      "tests/metamask/wallet-session.spec.ts", "tests/metamask/wallet-ui.ts", "tests/metamask/token-flows/helpers.ts",
                      "tests/metamask/regression-execution.spec.ts", "tests/trading/scenarios.ts", "tests/trading/regression.ts", "tests/trading/walletExecution.ts",
                      "tests/trading/uiReceipt.ts", "tests/trading/sandboxFunding.ts"]
        try:
            image_environment = json.loads(docker("image", "inspect", args.backend_image, "--format", "{{json .Config.Env}}"))
            backend_commit = next((value.split("=", 1)[1] for value in image_environment if value.startswith("CYBERGOLD_BACKEND_COMMIT=")), None)
            if backend_commit and re.fullmatch(r"[0-9a-f]{40}", backend_commit):
                evidence["backendCommit"] = backend_commit
            image_id = docker("image", "inspect", args.backend_image, "--format", "{{.Id}}")
            if re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
                evidence["backendImageId"] = image_id
        except (OSError, subprocess.CalledProcessError, ValueError):
            pass  # Optional image observations are not fixture requirements.
        evidence.update({
            "testInputSha256": {path: hashlib.sha256((work / path).read_bytes()).hexdigest() for path in test_paths},
            "contractsSha256": hashlib.sha256(args.contracts_json.read_bytes()).hexdigest(),
            "fundingSha256": hashlib.sha256(args.funding_json.read_bytes()).hexdigest(),
            "scope": "Sixteen UI-selected funded paths plus independent 20-case Core/market matrix with amount bounds, actual mined operation, authorization and receipts; rejection and three session/network cases; real Python API/native PG18/production Next.js; no product or receipt interception",
            "wallet": "New disposable seed/profile; no owner wallet or B2B/public-chain write",
        })
        checkpoint("wallet-cache")
        run(["node", "scripts/cache-metamask-wallet.mjs"], "new-wallet-cache", timeout=300)
        start_block = int(rpc(fork, "eth_blockNumber", []), 16)
        checkpoint("wallet-tests")
        run(["node", "node_modules/@playwright/test/cli.js", "test", "--config", "playwright.wallet.config.ts",
             "fixed-api-roundtrips.spec.ts", "wallet-session.spec.ts", "regression-execution.spec.ts"], "wallet-tests", timeout=4800)
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
                with (output / f"{name}.log").open("w") as stream:
                    subprocess.run(["docker", "logs", "--tail", "100", name], stdout=stream, stderr=subprocess.STDOUT)
            except OSError:
                pass  # A log write failure must not skip removal.
            try:
                if subprocess.run(["docker", "rm", "-f", "-v", name], stdout=subprocess.DEVNULL, check=False).returncode:
                    cleanup["containers"] = "failed"
            except OSError:
                cleanup["containers"] = "failed"
        if network_created:
            try:
                if subprocess.run(["docker", "network", "rm", network], stdout=subprocess.DEVNULL, check=False).returncode:
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
