#!/usr/bin/env python3
"""
nuqta_sync.py — read local Claude Code sessions and write a small JSON summary
that Nuqta can pick up.

Claude's cloud sandbox cannot see ~/.claude (it is walled off on purpose), so
this runs on your Mac instead and drops a plain file into a folder you have
connected to Claude. Nothing is uploaded by this script; it only writes locally.

Claude Code keeps one directory per working directory, so running it from a
subfolder of a project creates a second entry for the same project. This script
folds those children back into their parent, then hands Nuqta a stable id and a
company guess per project so the board never has to invent either.
"""

import json
import os
import sys
import glob
import re
import datetime

HOME = os.path.expanduser("~")
PROJECTS_DIR = os.path.join(HOME, ".claude", "projects")
DEFAULT_OUT = os.path.join(HOME, "NuqtaSync", "sessions.json")

HEAD_LINES = 60
MAX_TITLE = 90
RECENT_PER_FOLDER = 6

# Your repos live under a folder named for the company that owns them
# (Documents/GitHub/Anwar Creative Studio/artha), so the path is the best
# evidence there is. These are checked against the whole path first.
COMPANY_PATH_RULES = [
    ("anwar creative studio", "acs"),
    ("anwar logistics",       "al"),
    ("anwar autowerks",       "aaw"),
    ("anwar capital",         "ac"),
    ("anwar ventures",        "av"),
]

# Fallback when the path says nothing: guess from the name. First match wins.
COMPANY_RULES = [
    ("logistics", "al"),
    ("autowerks", "aaw"),
    ("capital",   "ac"),
    ("duplex",    "ac"),
    ("property",  "ac"),
    ("artha",     "acs"),
    ("doorsong",  "acs"),
    ("susurrus",  "acs"),
    ("stub",      "acs"),
    ("tether",    "acs"),
    ("watchlist", "acs"),
    ("portfolio", "acs"),
    ("tamkin",    "acs"),
    ("nuqta",     "av"),
]
DEFAULT_COMPANY = "acs"


def iso(dt):
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_from_epoch(ts):
    return iso(datetime.datetime.fromtimestamp(ts, datetime.timezone.utc))


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                out.append(block.get("text", ""))
            elif isinstance(block, str):
                out.append(block)
        return " ".join(out)
    return ""


def clean(s):
    s = " ".join(str(s or "").split())
    if s.startswith("<"):
        return ""
    if len(s) > MAX_TITLE:
        s = s[: MAX_TITLE - 1].rstrip() + "…"
    return s


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")
    return s or "project"


def company_for(path, folder):
    low = path.lower()
    for needle, co in COMPANY_PATH_RULES:
        if needle in low:
            return co
    hay = (path + " " + folder).lower()
    for needle, co in COMPANY_RULES:
        if needle in hay:
            return co
    return DEFAULT_COMPANY


def read_session(path):
    info = {
        "title": "", "summary": "", "cwd": "", "branch": "",
        "turns": 0, "mtime": os.path.getmtime(path),
    }
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except (ValueError, TypeError):
                    continue  # half-written line on a live session — normal
                if not isinstance(ev, dict):
                    continue
                if not info["cwd"] and ev.get("cwd"):
                    info["cwd"] = ev["cwd"]
                if not info["branch"] and ev.get("gitBranch"):
                    info["branch"] = ev["gitBranch"]
                t = ev.get("type")
                if t == "summary" and ev.get("summary"):
                    info["summary"] = clean(ev["summary"])
                elif t == "user":
                    info["turns"] += 1
                    if not info["title"] and i < HEAD_LINES:
                        msg = ev.get("message") or {}
                        if isinstance(msg, dict) and not ev.get("isMeta"):
                            info["title"] = clean(text_of(msg.get("content")))
    except (IOError, OSError):
        return None
    info["last_active"] = iso_from_epoch(info["mtime"])
    info["title"] = info["summary"] or info["title"] or "(untitled session)"
    return info


# Claude Code and git both park worktrees inside the repo. A worktree is a
# branch of a project, not a project — without this, every throwaway worktree
# becomes its own robot with a nonsense name like "laughing-bassi-789f75".
WORKTREE_MARKERS = ("/.claude/worktrees/", "/.git/worktrees/", "/.worktrees/",
                    "--claude-worktrees-", "--git-worktrees-", "--worktrees-")


def strip_worktree(path):
    low = path.lower()
    for marker in WORKTREE_MARKERS:
        i = low.find(marker)
        if i != -1:
            return path[:i]
    return path


def decode_dir(name):
    return "/" + name.lstrip("-").replace("-", "/") if name.startswith("-") else name


def encode_dir(path):
    """Claude Code names a project directory after its working path, mapping
    every non-alphanumeric character to a hyphen."""
    return re.sub(r"[^A-Za-z0-9]", "-", path)


# When a session was launched from a folder above the project, the leftover
# directory name carries the containing folders with it — "Anwar Creative
# Studio Tether" instead of "Tether". Strip those, but only from the front,
# so a real two-word name like "project watchlist" survives intact.
CONTAINERS = [c for c, _ in COMPANY_PATH_RULES] + [
    "documents", "github", "websites", "projects", "tamkin anwar projects", "code",
]


def trim_container(name):
    changed = True
    while changed:
        changed = False
        low = name.lower()
        for c in sorted(CONTAINERS, key=len, reverse=True):
            if low.startswith(c + " ") and len(name) > len(c) + 1:
                name = name[len(c) + 1:].strip()
                changed = True
                break
    return name


def resolve(entry, sessions):
    """Identify a project from its DIRECTORY NAME, not from recorded paths.

    `cwd` is written per event and is often the parent folder you launched
    from, so five sibling projects can all report the same path and collapse
    into one row. The directory name is assigned by Claude Code and is unique
    per project, so it — not cwd — is the identity. Paths are used only to
    make the name and company readable.

    Returns (key, path, name)."""
    key = strip_worktree(entry)

    seen = []
    for s in sessions:
        cwd = (s.get("cwd") or "").rstrip("/")
        if cwd and cwd not in seen:
            seen.append(cwd)

    # a path that re-encodes to the directory name is definitely the right one
    for cwd in seen:
        if encode_dir(cwd) == key:
            return key, cwd, os.path.basename(cwd) or cwd

    # otherwise the deepest path that is a strict ancestor tells us the
    # prefix, and the rest of the directory name is the project's own folder
    best = None
    for cwd in seen:
        enc = encode_dir(cwd)
        if key.startswith(enc + "-") and (best is None or len(enc) > len(encode_dir(best))):
            best = cwd
    if best:
        tail = key[len(encode_dir(best)) + 1:].replace("-", " ").strip()
        if tail:
            return key, best + "/" + tail, trim_container(tail)

    # no usable path at all — read what we can out of the directory name
    name = key.lstrip("-")
    for container in ("-GitHub-", "-Documents-", "-Websites-", "-projects-"):
        i = name.rfind(container)
        if i != -1:
            name = name[i + len(container):]
    return key, decode_dir(key), (trim_container(name.replace("-", " ").strip()) or key)


def scan():
    """One record per project, keyed by its Claude Code directory."""
    out = {}
    if not os.path.isdir(PROJECTS_DIR):
        return out

    for entry in sorted(os.listdir(PROJECTS_DIR)):
        d = os.path.join(PROJECTS_DIR, entry)
        if not os.path.isdir(d):
            continue
        sessions = [x for x in (read_session(f) for f in glob.glob(os.path.join(d, "*.jsonl"))) if x]
        if not sessions:
            continue
        key, path, name = resolve(entry, sessions)
        rec = out.setdefault(key, {"path": path, "name": name, "sessions": []})
        rec["sessions"].extend(sessions)
        # a real directory beats a worktree's reconstruction of the same project
        if entry == key:
            rec["path"], rec["name"] = path, name
    return out


def fold_children(recs):
    """`claude` run inside src/ makes a second directory for the same project.
    Fold any key that sits underneath another scanned key into that parent."""
    keys = sorted(recs.keys(), key=len)
    merged = {}
    for key in keys:
        parent = None
        for r in keys:
            if r != key and key.startswith(r + "-"):
                parent = r
                break
        target = parent or key
        if target not in merged:
            merged[target] = dict(recs[target])
            merged[target]["sessions"] = list(recs[target]["sessions"])
        if target != key:
            merged[target]["sessions"].extend(recs[key]["sessions"])
    return merged


def collect():
    merged = fold_children(scan())

    projects = []
    for key, rec in merged.items():
        sessions = sorted(rec["sessions"], key=lambda x: x["mtime"], reverse=True)
        newest = sessions[0]
        projects.append({
            "id": "cc-" + slug(key),          # from the directory: stable forever
            "folder": rec["name"],
            "path": rec["path"],
            "co": company_for(rec["path"], rec["name"]),
            "title": newest["title"],
            "branch": newest["branch"],
            "sessions": len(sessions),
            "turns": sum(x["turns"] for x in sessions),
            "last_active": newest["last_active"],
            "recent": [
                {"title": x["title"], "last_active": x["last_active"], "turns": x["turns"]}
                for x in sessions[:RECENT_PER_FOLDER]
            ],
        })

    counts = {}
    for pr in projects:
        counts[pr["folder"]] = counts.get(pr["folder"], 0) + 1
    for pr in projects:
        if counts[pr["folder"]] > 1:
            parent = os.path.basename(os.path.dirname(pr["path"]))
            if parent:
                pr["folder"] = parent + "/" + pr["folder"]

    projects.sort(key=lambda x: (x["last_active"], x["id"]), reverse=True)
    return projects


def load_ignores(out_path):
    """ignore.txt beside sessions.json: one substring per line, matched against
    a project's path and name. Scrapped projects keep their session history on
    disk forever, so without this the nightly sync resurrects them."""
    f = os.path.join(os.path.dirname(out_path) or ".", "ignore.txt")
    pats = []
    try:
        with open(f, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    pats.append(line.lower())
    except (IOError, OSError):
        pass
    return pats


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    projects = collect()

    ignores = load_ignores(out_path)
    if ignores:
        keep, dropped = [], 0
        for pr in projects:
            hay = (pr["path"] + " " + pr["folder"]).lower()
            if any(pat in hay for pat in ignores):
                dropped += 1
            else:
                keep.append(pr)
        projects = keep
    payload = {
        "generated_at": iso(datetime.datetime.now(datetime.timezone.utc)),
        "host": os.uname().nodename,
        "projects_dir": PROJECTS_DIR,
        "found": len(projects),
        "folders": projects,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, out_path)   # atomic — Claude never reads a half-written file

    print("wrote %s — %d project(s)%s"
          % (out_path, len(projects),
             (" (%d ignored)" % dropped) if ignores and dropped else ""))
    for p in projects:
        print("  %-34s %-4s %2d sess  %s  %s"
              % (p["folder"][:34], p["co"], p["sessions"],
                 p["last_active"][:10], p["title"][:44]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
