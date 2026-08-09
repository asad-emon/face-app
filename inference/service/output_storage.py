import os
from pathlib import PurePosixPath
from typing import Optional

from huggingface_hub import HfApi


def _clean_repo_type(repo_type: Optional[str]) -> str:
    value = str(repo_type or "dataset").strip().lower()
    if value not in {"dataset", "model", "space"}:
        raise ValueError("storage_repo_type must be dataset, model, or space")
    return value


def _clean_storage_key(storage_key: str) -> str:
    key = str(storage_key or "").strip().replace("\\", "/")
    path = PurePosixPath(key)
    if not key or path.is_absolute() or ".." in path.parts:
        raise ValueError("storage_key must be a relative Hugging Face path")
    return str(path)


def upload_output(
    local_path: str,
    storage_key: str,
    repo_id: str,
    repo_type: Optional[str] = None,
    revision: Optional[str] = None,
    commit_message: Optional[str] = None,
) -> int:
    """Upload a completed output directly from inference to the HF repo."""
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN (or HUGGINGFACE_TOKEN) is required for output storage")

    clean_repo_id = str(repo_id or "").strip()
    if not clean_repo_id:
        raise RuntimeError("HF_STORAGE_REPO is required for output storage")

    clean_key = _clean_storage_key(storage_key)
    clean_type = _clean_repo_type(repo_type)
    clean_revision = str(revision or "main").strip() or "main"
    size = os.path.getsize(local_path)

    HfApi(token=token).upload_file(
        path_or_fileobj=local_path,
        path_in_repo=clean_key,
        repo_id=clean_repo_id,
        repo_type=clean_type,
        revision=clean_revision,
        commit_message=commit_message or f"Store generated output {clean_key}",
    )
    return size