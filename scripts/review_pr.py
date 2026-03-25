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
    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    return json.loads(content)


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

    review = call_minimax(policy, user_prompt)
    comment_body = format_comment(review)

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
