"""
FastAPI application: REST API + WebSocket for the Devin clone.
"""
import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, Optional

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import (
    create_access_token,
    get_current_user_id,
    get_current_user_id_ws,
    hash_password,
    verify_password,
)
from database import get_db, init_db, AsyncSessionLocal
from models import Message, Session, User
from agent import AgentRunner

WORKSPACE_BASE = os.getenv("WORKSPACE_BASE", "/workspaces")
MAX_SESSIONS = int(os.getenv("MAX_SESSIONS", "10"))

# session_id -> asyncio.Event (stop signal)
_stop_events: Dict[str, asyncio.Event] = {}
# session_id -> list of connected WebSocket clients
_ws_clients: Dict[str, list] = {}


# ---------------------------------------------------------------------------
# App lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Devin Clone API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SessionCreate(BaseModel):
    title: Optional[str] = "New Session"


class SessionResponse(BaseModel):
    id: str
    title: str
    status: str
    cost_usd: float
    tokens_input: int
    tokens_output: int
    workspace_path: Optional[str]
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class MessageResponse(BaseModel):
    id: str
    role: str
    content: Optional[str]
    tool_calls: Optional[list]
    tool_results: Optional[list]
    created_at: str

    class Config:
        from_attributes = True


class SendMessageRequest(BaseModel):
    content: str


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.post("/auth/register", response_model=TokenResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(email=body.email, hashed_password=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@app.post("/auth/login", response_model=TokenResponse)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == form.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@app.get("/auth/me")
async def me(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user.id, "email": user.email}


# ---------------------------------------------------------------------------
# Session routes
# ---------------------------------------------------------------------------

@app.get("/sessions")
async def list_sessions(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session)
        .where(Session.user_id == user_id)
        .order_by(Session.created_at.desc())
    )
    sessions = result.scalars().all()
    return [
        {
            "id": s.id,
            "title": s.title,
            "status": s.status,
            "cost_usd": s.cost_usd,
            "tokens_input": s.tokens_input,
            "tokens_output": s.tokens_output,
            "workspace_path": s.workspace_path,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }
        for s in sessions
    ]


@app.post("/sessions", status_code=201)
async def create_session(
    body: SessionCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    # Count active sessions
    result = await db.execute(
        select(Session)
        .where(Session.user_id == user_id)
        .where(Session.status.in_(["idle", "thinking", "executing"]))
    )
    active = result.scalars().all()
    if len(active) >= MAX_SESSIONS:
        raise HTTPException(status_code=429, detail="Max sessions reached")

    session_id = str(uuid.uuid4())
    workspace = str(Path(WORKSPACE_BASE) / session_id)
    Path(workspace).mkdir(parents=True, exist_ok=True)

    session = Session(
        id=session_id,
        user_id=user_id,
        title=body.title or "New Session",
        workspace_path=workspace,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return {
        "id": session.id,
        "title": session.title,
        "status": session.status,
        "cost_usd": session.cost_usd,
        "workspace_path": workspace,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
    }


@app.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_owned_session(session_id, user_id, db)
    result = await db.execute(
        select(Message).where(Message.session_id == session_id).order_by(Message.created_at)
    )
    messages = result.scalars().all()
    return {
        "id": session.id,
        "title": session.title,
        "status": session.status,
        "cost_usd": session.cost_usd,
        "tokens_input": session.tokens_input,
        "tokens_output": session.tokens_output,
        "workspace_path": session.workspace_path,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "tool_calls": m.tool_calls,
                "tool_results": m.tool_results,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
    }


@app.post("/sessions/{session_id}/exec")
async def exec_command(
    session_id: str,
    body: SendMessageRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Direct terminal command execution (not through the agent)."""
    session = await _get_owned_session(session_id, user_id, db)
    workspace = session.workspace_path or str(Path(WORKSPACE_BASE) / session_id)

    from tools import execute_tool
    result = await execute_tool("bash_command", {"command": body.content, "timeout": 30}, workspace)
    return {"output": result}


@app.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_owned_session(session_id, user_id, db)
    # Stop any running agent
    if session_id in _stop_events:
        _stop_events[session_id].set()
    await db.delete(session)
    await db.commit()


@app.get("/sessions/{session_id}/files")
async def list_files(
    session_id: str,
    path: str = ".",
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_owned_session(session_id, user_id, db)
    workspace = session.workspace_path or str(Path(WORKSPACE_BASE) / session_id)

    try:
        base = Path(workspace).resolve()
        target = (base / path).resolve()
        if not str(target).startswith(str(base)):
            raise HTTPException(status_code=400, detail="Invalid path")
        if not target.exists():
            return []

        items = []
        for p in sorted(target.iterdir(), key=lambda x: (x.is_file(), x.name)):
            items.append(
                {
                    "name": p.name,
                    "path": str(p.relative_to(base)),
                    "is_dir": p.is_dir(),
                    "size": p.stat().st_size if p.is_file() else None,
                }
            )
        return items
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sessions/{session_id}/stop")
async def stop_session(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned_session(session_id, user_id, db)
    if session_id in _stop_events:
        _stop_events[session_id].set()
    await db.execute(
        update(Session).where(Session.id == session_id).values(status="stopped")
    )
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    session_id: str,
    token: str,
    db: AsyncSession = Depends(get_db),
):
    # Authenticate
    try:
        from auth import decode_token
        user_id = decode_token(token)
    except HTTPException:
        await websocket.close(code=4001)
        return

    # Check session ownership
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        await websocket.close(code=4004)
        return

    await websocket.accept()

    # Register client
    if session_id not in _ws_clients:
        _ws_clients[session_id] = []
    _ws_clients[session_id].append(websocket)

    # Ensure stop event exists
    if session_id not in _stop_events:
        _stop_events[session_id] = asyncio.Event()

    async def broadcast(data: str):
        """Send to all WebSocket clients of this session."""
        dead = []
        for ws in _ws_clients.get(session_id, []):
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            _ws_clients[session_id].remove(ws)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "stop":
                if session_id in _stop_events:
                    _stop_events[session_id].set()
                await db.execute(
                    update(Session).where(Session.id == session_id).values(status="stopped")
                )
                await db.commit()
                await broadcast(json.dumps({"type": "agent_status", "status": "stopped"}))
                continue

            if msg_type == "message":
                content: str = msg.get("content", "").strip()
                if not content:
                    continue

                # Reset stop event for this session
                _stop_events[session_id] = asyncio.Event()
                stop_event = _stop_events[session_id]

                # Save user message
                user_msg = Message(
                    session_id=session_id,
                    role="user",
                    content=content,
                )
                db.add(user_msg)

                # Update session title if first message
                if session.title == "New Session":
                    title = content[:60] + ("…" if len(content) > 60 else "")
                    await db.execute(
                        update(Session)
                        .where(Session.id == session_id)
                        .values(title=title, status="thinking")
                    )
                else:
                    await db.execute(
                        update(Session)
                        .where(Session.id == session_id)
                        .values(status="thinking")
                    )
                await db.commit()

                # Build conversation history from DB
                result = await db.execute(
                    select(Message)
                    .where(Message.session_id == session_id)
                    .order_by(Message.created_at)
                )
                db_messages = result.scalars().all()
                conversation = _build_conversation(db_messages)

                workspace = session.workspace_path or str(Path(WORKSPACE_BASE) / session_id)

                # Run agent in background
                agent = AgentRunner(
                    session_id=session_id,
                    workspace=workspace,
                    send=broadcast,
                    stop_event=stop_event,
                )

                async def run_agent():
                    try:
                        stats = await agent.run(conversation)
                        # Save assistant reply
                        # Find last assistant message in stats["messages"]
                        for m in reversed(stats["messages"]):
                            if m["role"] == "assistant":
                                text_parts = [
                                    b["text"]
                                    for b in (m["content"] if isinstance(m["content"], list) else [])
                                    if isinstance(b, dict) and b.get("type") == "text"
                                ]
                                tool_calls = [
                                    {
                                        "name": b["name"],
                                        "input": b["input"],
                                        "tool_use_id": b["id"],
                                    }
                                    for b in (m["content"] if isinstance(m["content"], list) else [])
                                    if isinstance(b, dict) and b.get("type") == "tool_use"
                                ]
                                msg_row = Message(
                                    session_id=session_id,
                                    role="assistant",
                                    content="\n".join(text_parts) if text_parts else None,
                                    tool_calls=tool_calls if tool_calls else None,
                                    tokens_output=stats["total_output_tokens"],
                                    tokens_input=stats["total_input_tokens"],
                                )
                                async with AsyncSessionLocal() as new_db:
                                    new_db.add(msg_row)
                                    await new_db.execute(
                                        update(Session)
                                        .where(Session.id == session_id)
                                        .values(
                                            status="idle",
                                            cost_usd=stats["cost_usd"],
                                            tokens_input=stats["total_input_tokens"],
                                            tokens_output=stats["total_output_tokens"],
                                        )
                                    )
                                    await new_db.commit()
                                break
                        await broadcast(
                            json.dumps(
                                {
                                    "type": "session_update",
                                    "cost_usd": stats["cost_usd"],
                                    "tokens_input": stats["total_input_tokens"],
                                    "tokens_output": stats["total_output_tokens"],
                                    "status": "idle",
                                }
                            )
                        )
                    except Exception as e:
                        await broadcast(json.dumps({"type": "error", "message": str(e)}))
                        async with AsyncSessionLocal() as new_db:
                            await new_db.execute(
                                update(Session)
                                .where(Session.id == session_id)
                                .values(status="error")
                            )
                            await new_db.commit()

                asyncio.create_task(run_agent())

    except WebSocketDisconnect:
        pass
    finally:
        if session_id in _ws_clients and websocket in _ws_clients[session_id]:
            _ws_clients[session_id].remove(websocket)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_owned_session(session_id: str, user_id: str, db: AsyncSession) -> Session:
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


def _build_conversation(db_messages) -> list:
    """Convert DB messages to Anthropic messages format."""
    messages = []
    for m in db_messages:
        if m.role == "user":
            if m.content:
                messages.append({"role": "user", "content": m.content})
        elif m.role == "assistant":
            content = []
            if m.content:
                content.append({"type": "text", "text": m.content})
            if m.tool_calls:
                for tc in m.tool_calls:
                    content.append(
                        {
                            "type": "tool_use",
                            "id": tc.get("tool_use_id", str(uuid.uuid4())),
                            "name": tc["name"],
                            "input": tc["input"],
                        }
                    )
            if content:
                messages.append({"role": "assistant", "content": content})
    return messages
