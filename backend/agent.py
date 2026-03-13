"""
Agent loop: drives the Claude AI with tool use.
Sends real-time events over WebSocket.
"""
import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import anthropic

from tools import execute_tool

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MODEL = os.getenv("MODEL", "claude-sonnet-4-5")
WORKSPACE_BASE = os.getenv("WORKSPACE_BASE", "/workspaces")

# Pricing (USD per token) — approximate for claude-sonnet-4-5
INPUT_PRICE_PER_TOKEN = 3.0 / 1_000_000
OUTPUT_PRICE_PER_TOKEN = 15.0 / 1_000_000

SYSTEM_PROMPT = """You are Devin, an autonomous AI software engineer. You help users build, fix, and improve software.

You have access to a workspace where you can:
- Execute bash commands (bash_command)
- Read and write files (read_file, write_file)
- Browse the filesystem (list_directory)
- Run git operations (git_command)
- Open URLs in a browser (browser_action)

Guidelines:
- Think step by step before acting
- Always explore the workspace before making changes
- Write clean, well-structured code
- Use git to track changes when appropriate
- Explain what you're doing at each step
- If something fails, diagnose and fix it
- Be proactive: don't just answer, actually implement solutions
"""

TOOLS: List[Dict[str, Any]] = [
    {
        "name": "bash_command",
        "description": (
            "Execute a bash/shell command in the workspace directory. "
            "Returns stdout+stderr and exit code. "
            "Use for running scripts, installing packages, compiling code, etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute",
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default 60, max 300)",
                    "default": 60,
                },
            },
            "required": ["command"],
        },
    },
    {
        "name": "read_file",
        "description": "Read the contents of a file in the workspace.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path relative to workspace root",
                },
            },
            "required": ["path"],
        },
    },
    {
        "name": "write_file",
        "description": "Write content to a file (creates directories as needed).",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path relative to workspace root",
                },
                "content": {
                    "type": "string",
                    "description": "Content to write to the file",
                },
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "list_directory",
        "description": "List files and directories at a given path in the workspace.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory path relative to workspace (default: '.')",
                    "default": ".",
                },
            },
            "required": [],
        },
    },
    {
        "name": "git_command",
        "description": (
            "Run a git command in the workspace. "
            "Provide the arguments after 'git', e.g. 'clone https://...' or 'commit -m \"msg\"'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Git sub-command and arguments (without the 'git' prefix)",
                },
            },
            "required": ["command"],
        },
    },
    {
        "name": "browser_action",
        "description": "Open a URL in the browser or take a screenshot of a webpage.",
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["open", "screenshot"],
                    "description": "Action to perform",
                },
                "url": {
                    "type": "string",
                    "description": "URL to open or screenshot",
                },
            },
            "required": ["action", "url"],
        },
    },
]


# ---------------------------------------------------------------------------
# Event helpers
# ---------------------------------------------------------------------------

def _evt(event_type: str, **kwargs) -> str:
    return json.dumps({"type": event_type, **kwargs})


# ---------------------------------------------------------------------------
# Agent runner
# ---------------------------------------------------------------------------

class AgentRunner:
    def __init__(
        self,
        session_id: str,
        workspace: str,
        send: Any,  # async callable(str)
        stop_event: asyncio.Event,
    ):
        self.session_id = session_id
        self.workspace = workspace
        self.send = send
        self.stop_event = stop_event
        self.client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.total_cost = 0.0

        # Ensure workspace exists
        Path(workspace).mkdir(parents=True, exist_ok=True)

    @property
    def cost_usd(self) -> float:
        return (
            self.total_input_tokens * INPUT_PRICE_PER_TOKEN
            + self.total_output_tokens * OUTPUT_PRICE_PER_TOKEN
        )

    async def run(self, conversation: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Run the agent loop.
        `conversation` is the full messages array (role/content pairs).
        Returns final stats dict.
        """
        messages = list(conversation)
        tool_call_count = 0
        MAX_TOOL_CALLS = 50  # safety limit

        while not self.stop_event.is_set() and tool_call_count < MAX_TOOL_CALLS:
            # ----------------------------------------------------------------
            # Call Claude (streaming)
            # ----------------------------------------------------------------
            await self.send(_evt("agent_status", status="thinking"))

            response_text = ""
            tool_uses = []
            input_tokens = 0
            output_tokens = 0

            try:
                async with self.client.messages.stream(
                    model=MODEL,
                    max_tokens=8096,
                    system=SYSTEM_PROMPT,
                    messages=messages,
                    tools=TOOLS,
                ) as stream:
                    async for event in stream:
                        if self.stop_event.is_set():
                            break

                        # Stream text
                        if hasattr(event, "type"):
                            if event.type == "content_block_delta":
                                delta = event.delta
                                if hasattr(delta, "text"):
                                    response_text += delta.text
                                    await self.send(_evt("text_delta", content=delta.text))

                    # Get full message after stream
                    final_msg = await stream.get_final_message()
                    input_tokens = final_msg.usage.input_tokens
                    output_tokens = final_msg.usage.output_tokens
                    stop_reason = final_msg.stop_reason

                    # Collect tool use blocks
                    for block in final_msg.content:
                        if block.type == "tool_use":
                            tool_uses.append(block)

            except anthropic.APIError as e:
                await self.send(_evt("error", message=f"API error: {e}"))
                break
            except Exception as e:
                await self.send(_evt("error", message=f"Agent error: {e}"))
                break

            # Update token counts
            self.total_input_tokens += input_tokens
            self.total_output_tokens += output_tokens

            await self.send(
                _evt(
                    "token_update",
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    total_cost=self.cost_usd,
                )
            )

            # Add assistant message to conversation
            # Build content for the assistant turn
            assistant_content = []
            if response_text:
                assistant_content.append({"type": "text", "text": response_text})
            for tu in tool_uses:
                assistant_content.append(
                    {
                        "type": "tool_use",
                        "id": tu.id,
                        "name": tu.name,
                        "input": tu.input,
                    }
                )

            if assistant_content:
                messages.append({"role": "assistant", "content": assistant_content})

            # ----------------------------------------------------------------
            # No tool calls → done
            # ----------------------------------------------------------------
            if not tool_uses or stop_reason == "end_turn":
                await self.send(_evt("agent_status", status="idle"))
                break

            if self.stop_event.is_set():
                await self.send(_evt("agent_status", status="stopped"))
                break

            # ----------------------------------------------------------------
            # Execute tools
            # ----------------------------------------------------------------
            await self.send(_evt("agent_status", status="executing"))

            tool_results = []
            for tool_use in tool_uses:
                if self.stop_event.is_set():
                    break

                tool_name = tool_use.name
                tool_input = tool_use.input
                tool_use_id = tool_use.id

                await self.send(
                    _evt(
                        "tool_call",
                        tool_use_id=tool_use_id,
                        tool_name=tool_name,
                        tool_input=tool_input,
                    )
                )

                result = await execute_tool(tool_name, tool_input, self.workspace)
                tool_call_count += 1

                await self.send(
                    _evt(
                        "tool_result",
                        tool_use_id=tool_use_id,
                        tool_name=tool_name,
                        result=result,
                    )
                )

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": result,
                    }
                )

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

        if self.stop_event.is_set():
            await self.send(_evt("agent_status", status="stopped"))

        return {
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "cost_usd": self.cost_usd,
            "messages": messages,
        }
