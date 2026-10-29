#!/usr/bin/env python3
"""Download the pinned, pure-Python wheels used by the browser runtime.

Run from the repository root: python3 scripts/vendor_wheels.py
Only pypi.org and files.pythonhosted.org are contacted. Every file is verified
against the SHA-256 digest published by PyPI before it is written.
"""
import hashlib
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "wheels"
PINS = {
    "micropip": "0.8.0",
    "packaging": "24.2",
    "pytelegrambotapi": "4.26.0",
    "python-telegram-bot": "21.10",
    "requests": "2.32.3",
    "urllib3": "2.3.0",
    "charset-normalizer": "3.4.1",
    "idna": "3.10",
    "certifi": "2025.1.31",
    "httpx": "0.27.2",
    "httpcore": "1.0.7",
    "h11": "0.14.0",
    "anyio": "4.8.0",
    "sniffio": "1.3.1",
    "typing-extensions": "4.12.2",
    "pyodide-http": "0.2.1",
}


def get_json(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, version in PINS.items():
        meta = get_json(f"https://pypi.org/pypi/{name}/{version}/json")
        candidates = [
            item for item in meta["urls"]
            if item["filename"].endswith(("-py3-none-any.whl", "-py2.py3-none-any.whl"))
        ]
        if len(candidates) != 1:
            raise RuntimeError(f"No unambiguous pure-Python wheel for {name}=={version}")
        item = candidates[0]
        with urllib.request.urlopen(item["url"], timeout=60) as response:
            data = response.read()
        digest = hashlib.sha256(data).hexdigest()
        if digest != item["digests"]["sha256"]:
            raise RuntimeError(f"Digest mismatch for {name}")
        (OUT / item["filename"]).write_bytes(data)
        manifest[name] = {"version": version, "file": item["filename"], "sha256": digest}
        print(f"{name}=={version}  {len(data):,} bytes")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
