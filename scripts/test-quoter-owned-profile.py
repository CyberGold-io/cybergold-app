"""Input projection for the owned quote phase; no Anvil/RPC/Docker is started."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("owned_quote_phase", Path(__file__).with_name("qualify-quoter-measurements.py"))
phase = importlib.util.module_from_spec(spec)
spec.loader.exec_module(phase)


class OwnedQuoteInputsTests(unittest.TestCase):
    def test_existing_contract_and_funding_files_supply_raw_cases_without_wallet_material(self):
        contracts = {"protocol": {"coreDiamond": "core"}, "helpers": {"diamond": "helpers", "uniswapAdapter": "adapter"}}
        funding = {"fork": {"funding": {"tokenFunding": {
            "symbols": ["USDC", "USDT"], "addresses": ["usdc", "usdt"], "holders": ["private-wallet"]}}}}
        args = SimpleNamespace(baseline_image="baseline", candidate_image="candidate", chain_id=1,
            routing_adapter=None, usdt_address=None, repetitions=3, docker_command="docker", platform="linux/amd64")
        value = phase.resource_configuration(contracts, funding, 6, 1234, args)
        self.assertEqual([row["amountRaw"] for row in value["cases"]], ["10000", "20000", "40000", "60000", "80000", "100000"])
        self.assertTrue(all(row["inputCurrency"] == "usdt" and row["outputCurrency"] == "core" for row in value["cases"]))
        self.assertNotIn("private-wallet", json.dumps(value))
        self.assertEqual(value["routingAdapter"], "adapter")
        args.routing_adapter = "selected-routing-adapter"
        self.assertEqual(phase.resource_configuration(contracts, funding, 6, 1234, args)["routingAdapter"], "selected-routing-adapter")

    def test_quote_only_phase_does_not_require_usdt_wallet_funding_catalog_membership(self):
        funding = {"fork": {"funding": {"tokenFunding": {"symbols": ["USDC"], "addresses": ["usdc"]}}}}
        self.assertEqual(phase.usdt_address(funding), phase.MAINNET_USDT)
        self.assertEqual(phase.usdt_address(None), phase.MAINNET_USDT)
        self.assertEqual(phase.usdt_address(funding, "explicit-fixture-usdt"), "explicit-fixture-usdt")

    def test_quote_only_setup_preserves_source_contract_state_without_safe_or_funding(self):
        rpc_methods, commands, configurations = [], [], []
        class Process:
            def __init__(self, command, **kwargs):
                commands.append(command)
                if "--resources" in command:
                    configurations.append(json.loads(Path(command[command.index("--resources")+1]).read_text()))
            def wait(self, **kwargs):
                return 0
            def poll(self):
                return 0
        def rpc(_url, method, _params):
            rpc_methods.append(method)
            return {"number": "0x64", "hash": "0x"+"a"*64} if method == "eth_getBlockByNumber" else "0x1"
        def token_decimals(command, **kwargs):
            commands.append(command)
            self.assertEqual(command[-1], "decimals()(uint8)")
            return "6\n"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contracts = root / "contracts.json"
            # Quote-only execution has no Safe or wallet fixture in its manifest.
            contracts.write_text(json.dumps({"protocol": {"coreDiamond": "core"},
                "helpers": {"diamond": "helpers", "uniswapAdapter": "adapter"}}))
            output = root / "results"
            with patch("sys.argv", ["qualify-quoter-measurements.py", "--baseline-image", "baseline",
                    "--candidate-image", "candidate", "--contracts-json", str(contracts), "--output-dir", str(output)]), \
                    patch.dict(os.environ, {"MAINNET_RPC_URL": "https://private-provider.invalid"}), \
                    patch.object(phase.qualifier, "rpc", rpc), patch.object(phase.qualifier, "free_port", return_value=1234), \
                    patch.object(phase.subprocess, "Popen", Process), patch.object(phase.subprocess, "check_output", token_decimals), \
                    patch.object(phase.subprocess, "run") as transaction, patch.object(phase.signal, "signal"):
                phase.main()
            transaction.assert_not_called()
            self.assertEqual(rpc_methods, ["eth_getBlockByNumber", "eth_chainId"])
            self.assertFalse(any("send" in command or "unpause()" in command for command in commands))
            self.assertEqual(len(configurations), 1)
            evidence = json.loads((output / "quote-setup.json").read_text())
            self.assertEqual(evidence["result"], "passed")
            self.assertEqual(evidence["corePauseState"], "unchanged")
            self.assertFalse(evidence["swapWalletFunding"])
            self.assertNotIn("private-provider", json.dumps(evidence))


if __name__ == "__main__":
    unittest.main()
