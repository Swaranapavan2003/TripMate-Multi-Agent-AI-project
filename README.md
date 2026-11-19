# TripMate AI: Multi-Agent Travel Planner

A production-grade Multi-Agent System built with **LangGraph**, **Model Context Protocol (MCP)**, **FastAPI**, and a modern web UI. It implements an intelligent travel assistant featuring a **Supervisor Agent**, **Input Guardrails**, **Domain Specialist Agents**, and **Human-In-The-Loop (HITL)** approval workflows.

---

## 🏛️ Architecture & Workflow

```
User Prompt
    │
    ▼
[Supervisor + Input Guardrails]
    │
    ├── (Blocked) ──────────────────────────────────────────► Guardrail Blocked Response ──► END
    │
    ▼ (Allowed: Routes dynamically to selected specialist agents)
┌────────────────────────────────────────────────────────┐
│  • Flight Agent (AviationStack MCP / Domain Fallback)  │
│  • Hotel Agent (Tavily MCP Search)                    │
│  • Weather Agent (Custom Weather FastMCP Server)      │
│  • Budget Agent (Affordability & Cost Analysis)        │
│  • Itinerary Agent (Integrated Day-by-Day Draft)       │
└────────────────────────────────────────────────────────┘
    │
    ▼
[Human-in-the-Loop Approval] (Interrupt state paused in Checkpointer)
    │
    ├── (Feedback / Revision) ──► Revises draft based on user feedback
    │
    ▼ (Approved)
[Final Response Agent] ──► Polished complete itinerary & travel plan ──► UI Display & PDF Download
```

---

## 🔑 Required API Keys & Configuration

Create a `.env` file in the project root directory (you can copy `.env.example`):

```powershell
Copy-Item .env.example .env
```

| Key | Status | Description | Where to get |
|---|---|---|---|
| `GROQ_API_KEY` | **Required** | Powers LLM reasoning (`llama-3.3-70b-versatile`) across all agents | [Groq Console](https://console.groq.com/keys) (Free) |
| `TAVILY_API_KEY` | **Recommended** | Powers live hotel and destination web search via Tavily MCP | [Tavily AI](https://tavily.com) (Free tier) |
| `OPENWEATHER_API_KEY` | **Recommended** | Powers real-time temperature and forecasts via Weather MCP | [OpenWeatherMap](https://home.openweathermap.org/api_keys) (Free) |
| `AVIATIONSTACK_API_KEY` | **Recommended** | Powers live airline and airport data via AviationStack MCP | [AviationStack](https://aviationstack.com) (Free tier) |
| `DATABASE_URL` | **Optional** | PostgreSQL URL for persistent state checkpointing (Render, Neon, Supabase, or local). *If omitted, the app automatically uses LangGraph's in-memory `MemorySaver`.* | [Neon](https://neon.tech) / [Render](https://render.com) |
| `LANGSMITH_API_KEY` | **Optional** | LangSmith observability and trace tracking for LangGraph steps | [LangSmith](https://smith.langchain.com) |

---

## 🚀 Quick Start Guide (Windows)

### 1. Open Terminal in the Project Directory
Make sure your terminal is opened in the project folder:
```powershell
cd c:\Users\swara\Downloads\Multi-Agent-System-using-LangGraph-MCP-Supervisor-Guardrails-HITL-main
```

### 2. Create and Activate a Virtual Environment
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```
*(If PowerShell blocks script execution, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` first).*

### 3. Install Dependencies
```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Configure Your `.env` File
Open `.env` in your text editor and paste your `GROQ_API_KEY`:
```ini
GROQ_API_KEY=gsk_your_actual_groq_key_here
TAVILY_API_KEY=tvly_your_actual_tavily_key_here
OPENWEATHER_API_KEY=your_actual_openweather_key_here
AVIATIONSTACK_API_KEY=your_actual_aviationstack_key_here
```

### 5. Run the Application
```powershell
python app.py
```
Or with Uvicorn:
```powershell
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

### 6. Open the Web Application
Open your browser and navigate to:
```
http://127.0.0.1:8000
```

---

## 🔌 MCP Servers Used

1. **Weather MCP Server (`custom_weather_mcp_server.py`)**:
   - Uses `FastMCP` over `stdio`.
   - Automatically spawned by `mcp_client.py` as a child process using your active Python environment.
   - You **do not** need to run it in a separate terminal during normal web app use.

2. **Tavily MCP Server**:
   - Hosted streamable HTTP endpoint (`https://mcp.tavily.com/mcp/?tavilyApiKey=...`).
   - Handles real-time search for hotels, attractions, and destination recommendations.

3. **AviationStack MCP Server**:
   - Runs via `uvx aviationstack-mcp` over `stdio`.
   - Requires `uv` (`pip install uv`).
   - If not installed or key is unavailable, the Flight Agent automatically falls back to domain-level flight planning without crashing.

---

## 📡 API Endpoints

- `GET /` — Serves the interactive TripMate web frontend.
- `POST /api/travel` — Submits a travel request to the supervisor. Returns initial draft and pauses at human approval.
  - Payload: `{"message": "Plan a 7-day trip to Tokyo", "thread_id": "optional-id"}`
- `POST /api/travel/approve` — Resumes the LangGraph thread to approve the draft or submit revision feedback.
  - Payload: `{"thread_id": "user_...", "approved": true, "feedback": ""}`
- `GET /health` — Health check endpoint returning API status and active features.

---

## 🐳 Docker Deployment

To build and run using Docker:
```bash
docker build -t tripmate-ai .
docker run -p 8000:8000 --env-file .env tripmate-ai
```
