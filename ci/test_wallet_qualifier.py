"""Pure log-projection controls; no Docker, RPC, browser or wallet access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("wallet_qualifier", Path(__file__).resolve().parents[1] / "scripts/qualify-fixed-api-wallet.py")
QUALIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(QUALIFIER)


class LogProjectionTests(unittest.TestCase):
    def test_owned_all_wallet_selection_preserves_every_native_file_and_hash_input(self):
        root = QUALIFIER.APP / "tests/metamask"
        expected = sorted(str(path.relative_to(root)) for path in root.rglob("*.spec.ts"))
        selected = QUALIFIER.wallet_test_selection(all_wallet_tests=True)
        self.assertEqual(selected, expected)
        self.assertIn("fixed-api-roundtrips.spec.ts", selected)
        self.assertIn("quoter-integration.spec.ts", selected)
        self.assertTrue(any(name.startswith("token-flows/") for name in selected))
        self.assertTrue(any(name.startswith("basket-flows/") for name in selected))
        self.assertEqual(QUALIFIER.wallet_test_selection(["wallet-session.spec.ts"], True), ["wallet-session.spec.ts"])

    def test_default_owned_profile_keeps_its_existing_files(self):
        self.assertEqual(QUALIFIER.wallet_test_selection(), ["fixed-api-roundtrips.spec.ts", "wallet-session.spec.ts",
            "regression-execution.spec.ts", "quoter-integration.spec.ts"])

    def test_all_wallet_inventory_comes_from_the_executed_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "archive/tests/metamask"
            root.mkdir(parents=True)
            (root / "fixed-api-roundtrips.spec.ts").write_text("archived test")
            (root.parent / "uncommitted.spec.ts").write_text("outside executed inventory")
            self.assertEqual(QUALIFIER.wallet_test_selection(all_wallet_tests=True, root=root), ["fixed-api-roundtrips.spec.ts"])
            # Focused Playwright selectors retain their original argument syntax.
            self.assertEqual(QUALIFIER.wallet_test_selection(["session.*"], True, root), ["session.*"])

    def test_whole_log_keeps_early_failure_and_omits_private_payloads(self):
        request_id = "28630b6c-7ebb-46cc-ad2a-b10ef0b101dd"
        failure = {"event": "quote_failure", "operation": "/api/account/core-permit", "context": "core-permit",
            "code": "rpc-timeout", "exceptionType": "TimeoutError", "requestId": request_id,
            "error": "postgresql://fixture:generated-password@db/private-provider-prose",
            "diagnostics": {"failureType": "http-error", "httpStatus": 502, "rpcMethod": "eth_call",
                            "providerMessage": "private-provider-prose", "params": "private-params"},
            "params": {"calldata": "private-calldata", "signature": "private-signature"},
            "traceback": "private-provider-traceback", "unknown": "private-unknown"}
        success = {"event": "quote_outcome", "outcome": "succeeded", "params": "private-success-data"}
        raw = "\n".join([json.dumps(failure)] + [json.dumps(success)] * 300
            + ["Traceback: private-non-JSON-provider-text", "INFO: Application startup complete. generated-password"])
        result = QUALIFIER.projected_container_logs(raw, "generated-password")
        self.assertEqual(result["failedEvents"], [{"event": "quote_failure", "operation": "/api/account/core-permit",
            "context": "core-permit", "code": "rpc-timeout", "exceptionType": "TimeoutError", "requestId": request_id,
            "diagnostics": {"failureType": "http-error", "httpStatus": 502, "rpcMethod": "eth_call"}}])
        self.assertEqual(result["startupTail"], [{"event": "api-startup-complete"}])
        encoded = json.dumps(result)
        for private in ("generated-password", "postgresql", "private-", "params", "calldata", "signature", "traceback"):
            self.assertNotIn(private, encoded)

    def test_failed_http_and_wallet_events_have_closed_fields_and_startup_is_bounded(self):
        rows = [{"msg": "request completed", "operation": "/api/account/core-permit", "statusCode": 503,
                 "durationMs": 15001.25, "requestId": "28630b6c-7ebb-46cc-ad2a-b10ef0b101dd"},
                {"event": "client_diagnostic", "operation": "swap", "outcome": "failed", "stage": "authorization",
                 "errorSelector": "0x12345678", "errorClassification": "private-error", "error": "private-prose"},
                {"event": "quote_failure", "operation": {"private": "invalid"}, "pid": 10**1000}]
        raw = "\n".join([json.dumps(row) for row in rows] + ["INFO: Application startup complete."] * 150)
        result = QUALIFIER.projected_container_logs(raw, "generated-password")
        self.assertEqual(result["failedEvents"][0]["event"], "http_failure")
        self.assertEqual(result["failedEvents"][0]["statusCode"], 503)
        self.assertEqual(result["failedEvents"][1], {"event": "client_diagnostic", "operation": "swap",
            "outcome": "failed", "stage": "authorization", "errorSelector": "0x12345678"})
        self.assertEqual(result["failedEvents"][2], {"event": "quote_failure"})
        self.assertEqual(len(result["startupTail"]), 100)
        self.assertNotIn("private", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
