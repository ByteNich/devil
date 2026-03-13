"""
Tool implementations for the agent.
Each tool receives workspace_path and the tool input dict.
Returns a string result (success or error message).
"""
import asyncio
import os
import subprocess
from pathlib import Path
from typing import Any, Dict

# SSH support
SSH_HOST = os.getenv("SSH_HOST", "")
SSH_USER = os.getenv("SSH_USER", "")
SSH_KEY_PATH = os.getenv("SSH_KEY_PATH", "")
SSH_PASSWORD = os.getenv("SSH_PASSWORD", "")

USE_SSH = bool(SSH_HOST and SSH_USER)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_path(workspace: str, rel_path: str) -> Path:
    """Resolve a relative path inside workspace, prevent path traversal."""
    base = Path(workspace).resolve()
    target = (base / rel_path).resolve()
    if not str(target).startswith(str(base)):
        raise ValueError(f"Path traversal detected: {rel_path}")
    return target


async def _run_local(command: str, workspace: str, timeout: int = 60) -> str:
    """Run a shell command locally in the workspace directory."""
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=workspace,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return f"[ERROR] Command timed out after {timeout}s"

        output = stdout.decode("utf-8", errors="replace")
        exit_code = proc.returncode
        if exit_code != 0:
            return f"[Exit {exit_code}]\n{output}"
        return output or "[Command completed with no output]"
    except Exception as e:
        return f"[ERROR] {e}"


async def _run_ssh(command: str, timeout: int = 60) -> str:
    """Run a shell command over SSH."""
    try:
        import paramiko

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        connect_kwargs: Dict[str, Any] = {
            "hostname": SSH_HOST,
            "username": SSH_USER,
            "timeout": 10,
        }
        if SSH_KEY_PATH:
            connect_kwargs["key_filename"] = SSH_KEY_PATH
        if SSH_PASSWORD:
            connect_kwargs["password"] = SSH_PASSWORD

        client.connect(**connect_kwargs)
        _, stdout, stderr = client.exec_command(command, timeout=timeout)

        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        exit_code = stdout.channel.recv_exit_status()
        client.close()

        combined = (out + err).strip()
        if exit_code != 0:
            return f"[Exit {exit_code}]\n{combined}"
        return combined or "[Command completed with no output]"
    except Exception as e:
        return f"[SSH ERROR] {e}"


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

async def tool_bash_command(workspace: str, inp: Dict[str, Any]) -> str:
    command: str = inp.get("command", "")
    timeout: int = int(inp.get("timeout", 60))

    if not command.strip():
        return "[ERROR] No command provided"

    if USE_SSH:
        return await _run_ssh(command, timeout=timeout)
    else:
        return await _run_local(command, workspace, timeout=timeout)


async def tool_read_file(workspace: str, inp: Dict[str, Any]) -> str:
    rel_path: str = inp.get("path", "")
    if not rel_path:
        return "[ERROR] No path provided"
    try:
        target = _safe_path(workspace, rel_path)
        if not target.exists():
            return f"[ERROR] File not found: {rel_path}"
        if not target.is_file():
            return f"[ERROR] Not a file: {rel_path}"
        content = target.read_text(encoding="utf-8", errors="replace")
        # Limit output to avoid token explosion
        if len(content) > 20000:
            content = content[:20000] + f"\n\n[... truncated, total {len(content)} chars]"
        return content
    except ValueError as e:
        return f"[ERROR] {e}"
    except Exception as e:
        return f"[ERROR] {e}"


async def tool_write_file(workspace: str, inp: Dict[str, Any]) -> str:
    rel_path: str = inp.get("path", "")
    content: str = inp.get("content", "")
    if not rel_path:
        return "[ERROR] No path provided"
    try:
        target = _safe_path(workspace, rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"File written: {rel_path} ({len(content)} bytes)"
    except ValueError as e:
        return f"[ERROR] {e}"
    except Exception as e:
        return f"[ERROR] {e}"


async def tool_list_directory(workspace: str, inp: Dict[str, Any]) -> str:
    rel_path: str = inp.get("path", ".")
    try:
        target = _safe_path(workspace, rel_path)
        if not target.exists():
            return f"[ERROR] Directory not found: {rel_path}"
        if not target.is_dir():
            return f"[ERROR] Not a directory: {rel_path}"

        lines = []
        for item in sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name)):
            prefix = "📁 " if item.is_dir() else "📄 "
            size = ""
            if item.is_file():
                try:
                    size = f" ({item.stat().st_size:,} bytes)"
                except Exception:
                    pass
            lines.append(f"{prefix}{item.name}{size}")

        if not lines:
            return "(empty directory)"
        return "\n".join(lines)
    except ValueError as e:
        return f"[ERROR] {e}"
    except Exception as e:
        return f"[ERROR] {e}"


async def tool_git_command(workspace: str, inp: Dict[str, Any]) -> str:
    git_cmd: str = inp.get("command", "")
    if not git_cmd.strip():
        return "[ERROR] No git command provided"

    full_cmd = f"git {git_cmd}"
    if USE_SSH:
        return await _run_ssh(f"cd {workspace} && {full_cmd}", timeout=120)
    else:
        return await _run_local(full_cmd, workspace, timeout=120)


async def tool_browser_action(workspace: str, inp: Dict[str, Any]) -> str:
    action: str = inp.get("action", "open")
    url: str = inp.get("url", "")
    # Browser integration is a stub — Playwright can be wired here later
    return (
        f"[BROWSER STUB] action={action} url={url}\n"
        "Browser automation is not yet configured. "
        "To enable it, install Playwright and implement tool_browser_action in tools.py."
    )


# ---------------------------------------------------------------------------
# Dispatch table
# ---------------------------------------------------------------------------

TOOL_HANDLERS = {
    "bash_command": tool_bash_command,
    "read_file": tool_read_file,
    "write_file": tool_write_file,
    "list_directory": tool_list_directory,
    "git_command": tool_git_command,
    "browser_action": tool_browser_action,
}


async def execute_tool(tool_name: str, tool_input: Dict[str, Any], workspace: str) -> str:
    handler = TOOL_HANDLERS.get(tool_name)
    if not handler:
        return f"[ERROR] Unknown tool: {tool_name}"
    try:
        return await handler(workspace, tool_input)
    except Exception as e:
        return f"[ERROR] Tool {tool_name} failed: {e}"
