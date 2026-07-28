"""Firebase Crashlytics API client for issue state management."""

from __future__ import annotations

import os
import re
import threading
from typing import Any, cast

import structlog
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from play_store_mcp.client import PlayStoreClientError, _run_with_backoff
from play_store_mcp.credentials import load_service_account_credentials

logger = structlog.get_logger(__name__)

CRASHLYTICS_SCOPES = ["https://www.googleapis.com/auth/firebase"]

# Crashlytics issue IDs are 32 lowercase hex characters. The API answers an
# unknown or truncated ID with 500 INTERNAL rather than 404, so validating the
# shape here turns an opaque "Internal error encountered." into a clear message.
_ISSUE_ID_RE = re.compile(r"^[0-9a-f]{32}$")


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

    if not _ISSUE_ID_RE.match(normalized["issue_id"]):
        raise PlayStoreClientError(
            "issue_id must be a full 32-character lowercase hex Crashlytics issue ID "
            f"(for example, c07d6e046632025ecd72f628ee1bf2ce), got {normalized['issue_id']!r}"
        )

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
        try:
            credentials = load_service_account_credentials(
                credentials_json=self._credentials_json,
                credentials_path=self._credentials_path,
                scopes=CRASHLYTICS_SCOPES,
                api_label="Firebase Crashlytics API",
            )

            # static_discovery=False is required: google-api-python-client only
            # ships bundled discovery documents for a subset of APIs, and
            # firebasecrashlytics v1alpha is not one of them. With the 2.x
            # default (static_discovery=True) build() raises
            # UnknownApiNameOrVersion before any request is made.
            self._service = build(
                "firebasecrashlytics",
                "v1alpha",
                credentials=credentials,
                cache_discovery=False,
                static_discovery=False,
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

        # The patch is idempotent, but the Crashlytics API answers a valid-looking
        # yet unknown issue ID with 500 INTERNAL. Retrying that just burns the
        # whole backoff before reporting a failure that will never succeed, so
        # fail fast on server errors and let 429s still be retried.
        return _run_with_backoff(_locked_execute, retry_server_errors=False)

    def close_issue(
        self,
        project_id: str,
        app_id: str,
        issue_id: str,
    ) -> dict[str, Any]:
        """Close a Firebase Crashlytics crash, non-fatal, or ANR issue.

        ``issue_id`` must be the full 32-character lowercase hex issue ID; the
        API answers a truncated or unknown ID with 500 INTERNAL, not 404.
        """
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
