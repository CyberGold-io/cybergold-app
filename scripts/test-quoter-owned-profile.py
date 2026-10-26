"""Input projection for the owned quote phase; no Anvil/RPC/Docker is started."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

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


if __name__ == "__main__":
    unittest.main()
