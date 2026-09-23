#!/usr/bin/env python3
"""Integration test for the remote credentials feature."""

import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest

# requests is only a transitive dependency; skip rather than error if absent.
requests = pytest.importorskip("requests")


def _find_free_port() -> int:
    """Find a free port by binding to port 0."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _read_log(log_path: str) -> str:
    return Path(log_path).read_text(encoding="utf-8", errors="replace")[-4000:]


def _wait_for_server(
    host: str, port: int, process: subprocess.Popen[bytes], log_path: str, timeout: float = 10.0
) -> None:
    """Poll until the server is accepting connections; fail fast if it exits."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f"Server exited early with code {process.returncode}:\n{_read_log(log_path)}"
            )
        try:
            with socket.create_connection((host, port), timeout=1):
                return
        except OSError:
            time.sleep(0.2)
    raise TimeoutError(
        f"Server on {host}:{port} not ready after {timeout}s:\n{_read_log(log_path)}"
    )


def test_credentials_endpoint():
    """Test the credentials endpoint with a running server."""
    port = _find_free_port()
    host = "127.0.0.1"

    # Start the server in the background. A network transport now requires
    # PLAY_STORE_MCP_DOWNLOAD_DIR (download-path confinement), so provide one.
    print(f"Starting MCP server on port {port}...")
    download_dir = tempfile.mkdtemp(prefix="play-store-mcp-dl-")
    # Output goes to a log file (not unread PIPEs, which can fill and block the
    # child). Run via the current interpreter so the console script need not
    # be on PATH.
    log_fd, log_path = tempfile.mkstemp(prefix="play-store-mcp-", suffix=".log")
    process = subprocess.Popen(  # noqa: S603
        [
            sys.executable,
            "-m",
            "play_store_mcp",
            "--transport",
            "streamable-http",
            "--host",
            host,
            "--port",
            str(port),
        ],
        stdout=log_fd,
        stderr=subprocess.STDOUT,
        env={**os.environ, "PLAY_STORE_MCP_DOWNLOAD_DIR": download_dir},
    )
    os.close(log_fd)

    try:
        _wait_for_server(host, port, process, log_path)

        base_url = f"http://{host}:{port}"

        # Test 1: Missing credentials
        print("\nTest 1: Missing credentials (should fail)")
        response = requests.post(
            f"{base_url}/credentials",
            json={},
            timeout=5,
        )
        assert response.status_code == 400
        assert not response.json()["success"]
        print("✓ Test 1 passed")

        # Test 2: Invalid JSON string
        print("\nTest 2: Invalid JSON string (should fail)")
        response = requests.post(
            f"{base_url}/credentials",
            json={"credentials": "not valid json"},
            timeout=5,
        )
        assert response.status_code == 400
        assert not response.json()["success"]
        print("✓ Test 2 passed")

        # Test 3: Invalid type
        print("\nTest 3: Invalid type (should fail)")
        response = requests.post(
            f"{base_url}/credentials",
            json={"credentials": 123},
            timeout=5,
        )
        assert response.status_code == 400
        assert not response.json()["success"]
        print("✓ Test 3 passed")

        print("\n✓ All integration tests passed!")

    finally:
        # Stop the server
        print("\nStopping server...")
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        Path(log_path).unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        test_credentials_endpoint()
    except Exception as e:
        print(f"\n✗ Integration test failed: {e}")
        sys.exit(1)
