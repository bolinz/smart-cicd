#!/usr/bin/env python3
import json
import os
import subprocess
from pathlib import Path

import requests


GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
MINIMAX_API_KEY = os.environ["MINIMAX_API_KEY"]
MINIMAX_MODEL = os.environ.get("MINIMAX_MODEL", "MiniMax-M2.5")
GITHUB_REPOSITORY = os.environ["GITHUB_REPOSITORY"]
GITHUB_EVENT_PATH = os.environ["GITHUB_EVENT_PATH"]


def gh_api(path: str):
    result = subprocess.run(
        [
            "gh", "api", path,
            "-H", "Accept: application/vnd.github+json",
            "-H", "X-GitHub-Api-Version: 2022-11-28",
        ],
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "GH_TOKEN": GITHUB_TOKEN},
    )
    return json.loads(result.stdout)


def gh_api_post(path: str, data: dict):
    cmd = [
        "gh", "api", path,
        "--method", "POST",
        "-H", "Accept: application/vnd.github+json",
        "-H", "X-GitHub-Api-Version: 2022-11-28",
    ]
    for k, v in data.items():
        cmd.extend(["-f", f"{k}={v}"])
    subprocess.run(
        cmd,
        check=True,
        env={**os.environ, "GH_TOKEN": GITHUB_TOKEN},
    )


def load_event():
    return json.loads(Path(GITHUB_EVENT_PATH).read_text(encoding="utf-8"))


def build_diff_text(owner: str, repo: str, pr_number: int) -> str:
    files = gh_api(f"/repos/{owner}/{repo}/pulls/{pr_number}/files")
    parts = []
    for f in files:
        filename = f.get("filename", "")
        status = f.get("status", "")
        patch = f.get("patch", "")
        parts.append(f"FILE: {filename}\nSTATUS: {status}\nPATCH:\n{patch}\n")
    return "\n\n".join(parts)


def call_minimax(system_prompt: str, user_prompt: str) -> dict:
    if not MINIMAX_API_KEY:
        raise EnvironmentError(
            "MINIMAX_API_KEY is not set. "
            "Add it as a GitHub Actions secret in repository Settings → Secrets → Actions."
        )
    url = "https://api.minimaxi.com/v1/text/chatcompletion_v2"
    headers = {
        "Authorization": f"Bearer {MINIMAX_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MINIMAX_MODEL,
        "messages": [
            {"role": "system", "name": "MiniMax AI", "content": system_prompt},
            {"role": "user", "name": "review-bot", "content": user_prompt},
        ],
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=120)
    resp.raise_for_status()
    try:
        data = resp.json()
    except ValueError as e:
        raise RuntimeError(
            f"MiniMax API returned non-JSON response (HTTP {resp.status_code}): "
            f"{resp.text[:500]!r}"
        )

    # Handle API-level errors
    if "error" in data:
        raise RuntimeError(f"MiniMax API error: {data['error']}")

    # Handle unexpected response shapes
    if "choices" not in data:
        raise RuntimeError(
            f"MiniMax API returned unexpected response (no 'choices' field). "
            f"Response: {data}"
        )

    content = data["choices"][0]["message"]["content"]

    # Handle empty content
    if not content:
        raise RuntimeError(
            "MiniMax API returned empty content. "
            "Check that the API key is valid and the model supports this request."
        )

    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        # MiniMax sometimes wraps JSON in markdown code fences
        stripped = content.strip()
        if stripped.startswith("```"):
            # Strip leading ```json and trailing ```
            lines = stripped.split("\n")
            if len(lines) >= 2 and lines[0].strip().startswith("```"):
                lines = lines[1:]  # Remove first line (```json)
            if lines and lines[-1].strip().endswith("```"):
                lines = lines[:-1]  # Remove last line (```)
            stripped = "\n".join(lines).strip()
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            raise RuntimeError(
                f"MiniMax API returned non-JSON content (JSONDecodeError: {e}). "
                f"Content preview: {content[:200]!r}"
            )


def format_comment(review: dict) -> str:
    lines = [
        "## MiniMax PR Review",
        "",
        f"**Verdict:** `{review['verdict']}`",
        "",
        f"**Summary:** {review['summary']}",
        "",
    ]
    findings = review.get("findings", [])
    if findings:
        lines.append("### Findings")
        for item in findings:
            lines.append(
                f"- **{item['severity']}** `{item['file']}` — **{item['title']}**: {item['detail']}"
            )
    else:
        lines.append("No findings.")
    return "\n".join(lines)


def try_enable_auto_merge(pr_number: int):
    subprocess.run(
        [
            "gh", "pr", "merge", str(pr_number),
            "--auto", "--squash",
            "--repo", GITHUB_REPOSITORY,
        ],
        check=False,
        env={**os.environ, "GH_TOKEN": GITHUB_TOKEN},
    )


def main():
    event = load_event()
    pr = event["pull_request"]
    owner, repo = GITHUB_REPOSITORY.split("/")
    pr_number = pr["number"]

    policy = Path("review/review-policy.md").read_text(encoding="utf-8")
    prompt = Path("review/review-prompt.md").read_text(encoding="utf-8")
    diff_text = build_diff_text(owner, repo, pr_number)

    user_prompt = (
        f"{prompt}\n\n"
        f"PR TITLE: {pr['title']}\n\n"
        f"PR BODY:\n{pr.get('body', '')}\n\n"
        f"DIFF:\n{diff_text}"
    )

    try:
        review = call_minimax(policy, user_prompt)
        comment_body = format_comment(review)
    except EnvironmentError as e:
        comment_body = (
            "## MiniMax PR Review\n\n"
            f"⚠️ **Configuration error:** {e}\n\n"
            "The workflow cannot run without a valid `MINIMAX_API_KEY` secret. "
            "Add it in **Settings → Secrets → Actions → New repository secret**."
        )
        gh_api_post(
            f"/repos/{owner}/{repo}/issues/{pr_number}/comments",
            {"body": comment_body},
        )
        return  # Exit gracefully — not a code bug
    except Exception as e:
        comment_body = (
            "## MiniMax PR Review\n\n"
            f"⚠️ **Review failed:** {type(e).__name__}: {e}"
        )
        gh_api_post(
            f"/repos/{owner}/{repo}/issues/{pr_number}/comments",
            {"body": comment_body},
        )
        raise  # Exit with error so CI shows failure

    gh_api_post(
        f"/repos/{owner}/{repo}/issues/{pr_number}/comments",
        {"body": comment_body},
    )

    has_blocking = any(
        item.get("severity") == "blocking"
        for item in review.get("findings", [])
    )
    if not has_blocking:
        try_enable_auto_merge(pr_number)


if __name__ == "__main__":
    main()
