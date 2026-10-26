#!/usr/bin/env python3
"""Quote measurement phase of mainnet-fork-execution, without wallet or App build.

Run under the existing authenticated tooling wrapper. The owned fork preserves
source contract state; only snapshots and block headers change between cases.
The existing wallet qualifier remains unchanged.
"""
from __future__ import annotations

import argparse
from decimal import Decimal
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

APP = Path(__file__).resolve().parents[1]
MAINNET_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
spec = importlib.util.spec_from_file_location("fixed_api_wallet_qualifier", APP / "scripts/qualify-fixed-api-wallet.py")
qualifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualifier)


def usdt_address(funding, override=None):
    if override:
        return override
    tokens = (funding or {}).get("fork", {}).get("funding", {}).get("tokenFunding", {})
    return next((address for symbol, address in zip(tokens.get("symbols", []), tokens.get("addresses", []))
                 if symbol == "USDT"), MAINNET_USDT)


def resource_configuration(contracts, funding, decimals, fork_port, args):
    usdt = usdt_address(funding, args.usdt_address)
    core = contracts["protocol"]["coreDiamond"]
    return {"baselineImage": args.baseline_image, "candidateImage": args.candidate_image,
        "forkUrl": f"http://127.0.0.1:{fork_port}",
        "backendForkUrl": f"http://host.docker.internal:{fork_port}",
        "chainId": args.chain_id, "core": core, "helpers": contracts["helpers"]["diamond"],
        "routingAdapter": args.routing_adapter or contracts["helpers"]["uniswapAdapter"],
        "repetitions": args.repetitions, "dockerCommand": args.docker_command,
        "platform": args.platform, "postgresImage": qualifier.POSTGRES,
        "cases": [{"id": "quoter-usdt-"+amount.replace(".", "-"),
            "inputCurrency": usdt, "outputCurrency": core,
            "amountRaw": str(int(Decimal(amount)*10**decimals))}
            for amount in ("0.01", "0.02", "0.04", "0.06", "0.08", "0.10")]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-image", required=True)
    parser.add_argument("--candidate-image", required=True)
    parser.add_argument("--contracts-json", required=True, type=Path)
    parser.add_argument("--funding-json", type=Path)
    parser.add_argument("--routing-adapter")
    parser.add_argument("--usdt-address")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--chain-id", type=int, default=1)
    parser.add_argument("--fork-block", type=int)
    parser.add_argument("--node-command", default=os.environ.get("NODE_COMMAND", "node"))
    parser.add_argument("--docker-command", default=os.environ.get("DOCKER_COMMAND", "docker"))
    parser.add_argument("--platform", default="linux/amd64")
    args = parser.parse_args()
    output = (args.output_dir or Path(tempfile.mkdtemp(prefix="cybergold-quoter-"))).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    evidence = {"profile": "mainnet-fork-execution", "phase": "quote-measurement", "result": "running",
        "stage": "inputs", "chainId": args.chain_id,
        "scope": "owned local fork; read-only economic quotes; source contract state preserved",
        "corePauseState": "unchanged", "swapWalletFunding": False}
    fork_process = runner = None
    private_inputs = output / "owned-resources.json"
    def checkpoint(stage):
        evidence["stage"] = stage
        (output / "quote-setup.json").write_text(json.dumps(evidence, indent=2)+"\n")
    def interrupted(signum, _frame):
        raise SystemExit(128+signum)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        contracts = json.loads(args.contracts_json.read_text())
        funding = json.loads(args.funding_json.read_text()) if args.funding_json else None
        checkpoint("fork")
        anchor = qualifier.rpc(os.environ["MAINNET_RPC_URL"], "eth_getBlockByNumber",
            [hex(args.fork_block) if args.fork_block is not None else "finalized", False])
        block = int(anchor["number"], 16)
        evidence.update(forkBlock=block, forkBlockHash=anchor["hash"])
        fork_port = qualifier.free_port()
        fork_url = f"http://127.0.0.1:{fork_port}"
        with (output / "owned-anvil.log").open("w") as stream:
            fork_process = subprocess.Popen(["anvil", "--fork-url", os.environ["MAINNET_RPC_URL"],
                "--fork-block-number", str(block), "--chain-id", str(args.chain_id),
                "--port", str(fork_port), "--host", "0.0.0.0", "--silent"],
                stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(150):
            try:
                if int(qualifier.rpc(fork_url, "eth_chainId", []), 16) == args.chain_id:
                    break
            except OSError:
                time.sleep(.2)
        else:
            raise RuntimeError("owned-fork-startup-failed")
        checkpoint("token-metadata")
        usdt = usdt_address(funding, args.usdt_address)
        decimals = int(subprocess.check_output(["cast", "call", "--rpc-url", fork_url, usdt,
                                               "decimals()(uint8)"], text=True).strip())
        configuration = resource_configuration(contracts, funding, decimals, fork_port, args)
        qualifier.private_env(private_inputs, {})
        private_inputs.write_text(json.dumps(configuration))
        checkpoint("quote-benchmark")
        runner = subprocess.Popen([args.node_command, "scripts/run-owned-quoter-benchmark.mts",
            "--resources", str(private_inputs), "--output", str(output / "quoter-measurements.json")],
            cwd=APP, start_new_session=True)
        code = runner.wait()
        evidence["result"] = "passed" if code == 0 else "failed"
        if code:
            raise RuntimeError("quote-measurements-failed")
        checkpoint("complete")
    except (Exception, SystemExit) as error:
        evidence.update(result="failed", errorClass=type(error).__name__)
        checkpoint(evidence["stage"])
        raise SystemExit(1) from None
    finally:
        for process in (runner, fork_process):
            if process is not None and process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
        private_inputs.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
