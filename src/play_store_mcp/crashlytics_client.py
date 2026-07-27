"""Firebase Crashlytics API client for issue state management."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, cast

import structlog
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from play_store_mcp.client import PlayStoreClientError, _run_with_backoff

logger = structlog.get_logger(__name__)

CRASHLYTICS_SCOPES = ["https://www.googleapis.com/auth/firebase"]


def _issue_resource_name(project_id: str, app_id: str, issue_id: str) -> str:
    """Build a Crashlytics issue resource name from validated path segments."""
    segments = {
        "project_id": project_id,
        "app_id": app_id,
        "issue_id": issue_id,
    }
    normalized: dict[str, str] = {}
    for field, value in segments.items():
        value = value.strip()
        if not value:
            raise PlayStoreClientError(f"{field} must not be empty")
        if "/" in value:
            raise PlayStoreClientError(f"{field} must be an ID, not a resource path containing '/'")
        normalized[field] = value

    return (
        f"projects/{normalized['project_id']}/apps/{normalized['app_id']}"
        f"/issues/{normalized['issue_id']}"
    )


class CrashlyticsClient:
    """Client for the Firebase Crashlytics API."""

    def __init__(
        self,
        credentials_path: str | None = None,
        credentials_json: str | dict[str, Any] | None = None,
    ) -> None:
        self._credentials_path = credentials_path or os.environ.get(
            "GOOGLE_APPLICATION_CREDENTIALS"
        )
        self._credentials_json = credentials_json or os.environ.get("GOOGLE_PLAY_STORE_CREDENTIALS")
        self._service: Any = None
        self._http_lock = threading.Lock()
        self._logger = logger.bind(component="CrashlyticsClient")

    def _get_service(self) -> Any:
        if self._service is not None:
            return self._service

        self._logger.info("Initializing Firebase Crashlytics API client")
        credentials = None
        try:
            credentials_json = self._credentials_json
            if isinstance(credentials_json, str):
                credentials_json = json.loads(credentials_json)

            if isinstance(credentials_json, dict):
                credentials = service_account.Credentials.from_service_account_info(
                    credentials_json,
                    scopes=CRASHLYTICS_SCOPES,
                )
            elif self._credentials_path:
                credentials_path = Path(self._credentials_path)
                if credentials_path.exists():
                    credentials = service_account.Credentials.from_service_account_file(
                        str(credentials_path),
                        scopes=CRASHLYTICS_SCOPES,
                    )

            if not credentials:
                raise PlayStoreClientError(
                    "No valid credentials found for Firebase Crashlytics API. "
                    "Set GOOGLE_APPLICATION_CREDENTIALS."
                )

            self._service = build(
                "firebasecrashlytics",
                "v1alpha",
                credentials=credentials,
                cache_discovery=False,
            )
            self._logger.info("Firebase Crashlytics API client initialized successfully")
            return self._service
        except Exception as e:
            if isinstance(e, PlayStoreClientError):
                raise
            self._logger.exception(
                "Failed to initialize Firebase Crashlytics API client",
                error=str(e),
            )
            raise PlayStoreClientError(
                f"Failed to initialize Firebase Crashlytics API client: {e}"
            ) from e

    def _execute(self, request: Any) -> Any:
        def _locked_execute() -> Any:
            with self._http_lock:
                return request.execute()

        # Updating an issue to a specific state is idempotent, so transient
        # server errors are safe to retry.
        return _run_with_backoff(_locked_execute, retry_server_errors=True)

    def close_issue(
        self,
        project_id: str,
        app_id: str,
        issue_id: str,
    ) -> dict[str, Any]:
        """Close a Firebase Crashlytics crash, non-fatal, or ANR issue."""
        name = _issue_resource_name(project_id, app_id, issue_id)
        service = self._get_service()
        try:
            return cast(
                "dict[str, Any]",
                self._execute(
                    service.projects()
                    .apps()
                    .issues()
                    .patch(
                        name=name,
                        updateMask="state",
                        body={"name": name, "state": "CLOSED"},
                    )
                ),
            )
        except HttpError as e:
            self._logger.exception(
                "Crashlytics issue close failed",
                issue_name=name,
                error=str(e),
            )
            raise PlayStoreClientError(
                f"Failed to close Firebase Crashlytics issue: {e.reason}"
            ) from e
