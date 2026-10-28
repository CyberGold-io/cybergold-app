"""Pure log-projection controls; no Docker, RPC, browser or wallet access."""
import importlib.util
import json
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location("wallet_qualifier", Path(__file__).resolve().parents[1] / "scripts/qualify-fixed-api-wallet.py")
QUALIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(QUALIFIER)


class LogProjectionTests(unittest.TestCase):
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
