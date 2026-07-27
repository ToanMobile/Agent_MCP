"""Tests for Firebase Crashlytics issue state management."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from googleapiclient.errors import HttpError

import play_store_mcp.server as server
from play_store_mcp.client import PlayStoreClientError
from play_store_mcp.crashlytics_client import (
    CRASHLYTICS_SCOPES,
    CrashlyticsClient,
    _issue_resource_name,
)


def _make_http_error(reason: str = "boom") -> HttpError:
    response = MagicMock()
    response.status = 400
    response.reason = reason
    error = HttpError(response, b"{}")
    error.reason = reason
    return error


def _issues(service: MagicMock) -> MagicMock:
    return service.projects.return_value.apps.return_value.issues.return_value


def test_issue_resource_name() -> None:
    assert (
        _issue_resource_name("my-project", "1:123:android:abc", "issue-42")
        == "projects/my-project/apps/1:123:android:abc/issues/issue-42"
    )


@pytest.mark.parametrize(
    ("field_value", "message"),
    [
        ("", "must not be empty"),
        ("projects/p", "must be an ID"),
    ],
)
def test_issue_resource_name_rejects_invalid_segments(
    field_value: str,
    message: str,
) -> None:
    with pytest.raises(PlayStoreClientError, match=message):
        _issue_resource_name(field_value, "app", "issue")


def test_close_issue_sets_closed_state() -> None:
    service = MagicMock()
    expected = {
        "name": "projects/my-project/apps/1:123:android:abc/issues/issue-42",
        "state": "CLOSED",
        "errorType": "ANR",
    }
    _issues(service).patch.return_value.execute.return_value = expected
    client = CrashlyticsClient(credentials_json={"type": "service_account"})
    client._service = service

    result = client.close_issue("my-project", "1:123:android:abc", "issue-42")

    assert result == expected
    _issues(service).patch.assert_called_once_with(
        name="projects/my-project/apps/1:123:android:abc/issues/issue-42",
        updateMask="state",
        body={
            "name": "projects/my-project/apps/1:123:android:abc/issues/issue-42",
            "state": "CLOSED",
        },
    )


def test_close_issue_wraps_http_error() -> None:
    service = MagicMock()
    _issues(service).patch.return_value.execute.side_effect = _make_http_error("denied")
    client = CrashlyticsClient(credentials_json={"type": "service_account"})
    client._service = service

    with pytest.raises(
        PlayStoreClientError,
        match="Failed to close Firebase Crashlytics issue: denied",
    ):
        client.close_issue("my-project", "1:123:android:abc", "issue-42")


def test_get_service_uses_firebase_scope_and_discovery_api() -> None:
    credentials = MagicMock()
    service = MagicMock()
    with (
        patch(
            "play_store_mcp.crashlytics_client.service_account.Credentials"
            ".from_service_account_info",
            return_value=credentials,
        ) as from_info,
        patch(
            "play_store_mcp.crashlytics_client.build",
            return_value=service,
        ) as build,
    ):
        client = CrashlyticsClient(credentials_json=json.dumps({"type": "service_account"}))

        assert client._get_service() is service

    from_info.assert_called_once_with(
        {"type": "service_account"},
        scopes=CRASHLYTICS_SCOPES,
    )
    build.assert_called_once_with(
        "firebasecrashlytics",
        "v1alpha",
        credentials=credentials,
        cache_discovery=False,
    )


def test_client_uses_shared_credentials_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    credentials = {"type": "service_account", "project_id": "my-project"}
    monkeypatch.setenv("GOOGLE_PLAY_STORE_CREDENTIALS", json.dumps(credentials))

    client = CrashlyticsClient()

    assert client._credentials_json == json.dumps(credentials)


def test_close_crashlytics_issue_tool() -> None:
    client = MagicMock()
    client.close_issue.return_value = {"state": "CLOSED", "errorType": "FATAL"}

    with patch(
        "play_store_mcp.server.get_crashlytics_client_from_context",
        return_value=client,
    ):
        result = server.close_crashlytics_issue(
            "my-project",
            "1:123:android:abc",
            "issue-42",
        )

    assert result == {"state": "CLOSED", "errorType": "FATAL"}
    client.close_issue.assert_called_once_with(
        project_id="my-project",
        app_id="1:123:android:abc",
        issue_id="issue-42",
    )


def test_close_crashlytics_issue_respects_read_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server, "READ_ONLY", True)
    get_client = MagicMock()
    monkeypatch.setattr(server, "get_crashlytics_client_from_context", get_client)

    result = server.close_crashlytics_issue(
        "my-project",
        "1:123:android:abc",
        "issue-42",
    )

    assert "read-only mode" in result["error"]
    get_client.assert_not_called()
