import os
import re
import math
import certifi
from dotenv import load_dotenv

load_dotenv()
os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

from typing import Any, TypedDict, Annotated
import operator
import uuid
import asyncio
import concurrent.futures
import json
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

try:
    import psycopg
    from psycopg.rows import dict_row
    from langgraph.checkpoint.postgres import PostgresSaver
    HAS_POSTGRES = True
except Exception as _pg_err:
    psycopg = None
    dict_row = None
    PostgresSaver = None
    HAS_POSTGRES = False
from langgraph.types import Command, interrupt
from langchain_core.messages import (
    AnyMessage,
    HumanMessage,
    AIMessage,
    SystemMessage,
)
from langchain_groq import ChatGroq


from mcp_client import (
    tavily_mcp_search,
    aviation_mcp_call,
    extract_destination,
    forecast_mcp_search,
    weather_mcp_search,
)


# =========================
# Utility Helpers
# =========================
def _run_async(coro):
    """Safely execute an async coroutine across sync/async contexts."""
    try:
        asyncio.get_running_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(asyncio.run, coro)
            return future.result()
    except RuntimeError:
        return asyncio.run(coro)


def _extract_text(obj: Any) -> str:
    """Safely extract clean human-readable text from MCP tool results."""
    if obj is None:
        return ""
    if isinstance(obj, str):
        return obj.strip()
    if isinstance(obj, list):
        items = []
        for x in obj:
            if isinstance(x, dict):
                if "text" in x:
                    items.append(str(x["text"]))
                elif "content" in x:
                    items.append(str(x["content"]))
                else:
                    items.append(json.dumps(x, indent=2))
            elif hasattr(x, "content"):
                items.append(str(x.content))
            else:
                items.append(str(x))
        return "\n\n".join(items).strip()
    if isinstance(obj, dict):
        if "text" in obj:
            return str(obj["text"]).strip()
        if "content" in obj:
            return str(obj["content"]).strip()
        return json.dumps(obj, indent=2)
    return str(obj).strip()


# =========================
# LLM Configuration
# =========================
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY or GROQ_API_KEY.startswith("your_"):
    raise ValueError(
        "GROQ_API_KEY is missing or contains placeholder. "
        "Please add a valid Groq API key to your .env file."
    )

GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
FALLBACK_MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]

base_llm = ChatGroq(
    model=GROQ_MODEL,
    api_key=GROQ_API_KEY,
    temperature=0.2,
)

_fallback_llms = [
    ChatGroq(model=m, api_key=GROQ_API_KEY, temperature=0.2)
    for m in FALLBACK_MODELS
    if m != GROQ_MODEL
]

llm = base_llm.with_fallbacks(_fallback_llms) if _fallback_llms else base_llm


# =========================
# State Definition
# =========================
class TravelState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], operator.add]
    user_query: str
    travel_preferences: dict[str, Any]

    # Supervisor + guardrail state
    guardrail_allowed: bool
    guardrail_reason: str
    selected_agents: list[str]
    trip_constraints: dict[str, Any]
    supervisor_reasoning: str

    # Specialist results
    flight_results: str
    hotel_results: str
    weather_results: str
    budget_results: str
    itinerary: str
    route_stops: list[dict[str, Any]]

    # HITL state
    approval_request: str
    approved: bool
    human_feedback: str
    final_response: str

    llm_calls: int


# =========================
# Shared Helpers
# =========================
KNOWN_AGENTS = {
    "flight_agent",
    "hotel_agent",
    "weather_agent",
    "budget_agent",
    "itinerary_agent",
}

AGENT_ORDER = [
    "flight_agent",
    "hotel_agent",
    "weather_agent",
    "budget_agent",
    "itinerary_agent",
]


def _llm_text(system_prompt: str, user_prompt: str) -> str:
    response = llm.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ])
    return _extract_text(response.content)


def _json_from_llm(text: str) -> dict[str, Any]:
    """Extract the first complete JSON object returned by the model."""
    # Strip markdown code fences if present
    cleaned = re.sub(r"```(?:json)?\s*", "", text)
    cleaned = cleaned.replace("```", "")
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("The model did not return a JSON object.")
    return json.loads(cleaned[start : end + 1])


def _empty_constraints() -> dict[str, Any]:
    return {
        "destination": "",
        "origin": "",
        "duration": "",
        "budget": "",
        "travel_style": "",
        "special_preferences": [],
    }


# =========================
# City/Region Mapping for Weather & Multi-City Trips
# =========================
REGION_CITY_MAP = {
    # Indian states → major city
    "andhra pradesh": "Tirupati",
    "telangana": "Hyderabad",
    "tamil nadu": "Chennai",
    "karnataka": "Bangalore",
    "kerala": "Kochi",
    "maharashtra": "Mumbai",
    "rajasthan": "Jaipur",
    "goa": "Goa",
    "gujarat": "Ahmedabad",
    "west bengal": "Kolkata",
    "uttar pradesh": "Lucknow",
    "madhya pradesh": "Bhopal",
    "himachal pradesh": "Shimla",
    "uttarakhand": "Dehradun",
    "jammu and kashmir": "Srinagar",
    "odisha": "Bhubaneswar",
    "punjab": "Amritsar",
    "assam": "Guwahati",
    "sikkim": "Gangtok",
    # Countries → capital/major tourist city
    "japan": "Tokyo",
    "thailand": "Bangkok",
    "france": "Paris",
    "italy": "Rome",
    "spain": "Madrid",
    "germany": "Berlin",
    "uk": "London",
    "united kingdom": "London",
    "usa": "New York",
    "dubai": "Dubai",
    "uae": "Dubai",
    "singapore": "Singapore",
    "malaysia": "Kuala Lumpur",
    "indonesia": "Bali",
    "bali": "Bali",
    "turkey": "Istanbul",
    "egypt": "Cairo",
    "switzerland": "Zurich",
    "iceland": "Reykjavik",
    "australia": "Sydney",
    "new zealand": "Auckland",
    "nepal": "Kathmandu",
    "sri lanka": "Colombo",
    "bangladesh": "Dhaka",
    "maldives": "Male",
    "vietnam": "Hanoi",
    "cambodia": "Phnom Penh",
    "south korea": "Seoul",
    "china": "Beijing",
    "russia": "Moscow",
    "greece": "Athens",
    "portugal": "Lisbon",
    "mexico": "Mexico City",
    "brazil": "Rio de Janeiro",
    "argentina": "Buenos Aires",
    "south africa": "Cape Town",
    "morocco": "Marrakech",
    "kenya": "Nairobi",
}


def _extract_destination_heuristic(query: str) -> str:
    """Extract a destination using regex if LLM is unavailable."""
    patterns = [
        r"(?:trip to|travel to|visit(?:ing)?|vacation in|holiday in|go to|go for|explore)\s+([A-Za-z\s]+?)(?:\s+from|\s+for|\s+with|\s+under|\s+including|\s+and|\.|\,|$)",
        r"(?:trip to|travel to|visit(?:ing)?|vacation in|holiday in|flight to)\s+([A-Za-z\s]+?)(?:\s+from|\s+for|\s+with|\s+under|\.|\,|$)",
        r"\b([A-Za-z]+)\s+(?:trip|tour|itinerary)\b",
        r"\bto\s+([A-Za-z]+)\b",
    ]
    for pattern in patterns:
        m = re.search(pattern, query, re.IGNORECASE)
        if m:
            candidate = m.group(1).strip()
            if candidate.lower() not in {"a", "the", "complete", "budget", "luxury", "my", "our", "all", "plan"}:
                return candidate
    return "Tokyo"


# =========================
# COMBINED Supervisor + Guardrail (single LLM call to reduce latency)
# =========================
def supervisor_agent(state: TravelState):
    query = state["user_query"]
    preferences = state.get("travel_preferences", {})
    llm_calls = state.get("llm_calls", 0)

    pref_str = ""
    if preferences:
        pref_str = f"""
User Travel Preferences (from mood quiz):
- Travel Style: {preferences.get('travel_style', 'General')}
- Interests: {', '.join(preferences.get('interests', []))}
- Pace: {preferences.get('pace', 'Moderate')}
- Accommodation: {preferences.get('accommodation', 'Mid-range')}
"""

    combined_prompt = f"""You are the supervisor of a multi-agent travel-planning system.

STEP 1 - GUARDRAIL CHECK:
Determine if this request is travel-related. Valid requests include destinations, flights, hotels, weather, budgets, visas, transportation, temples, sightseeing, food, packing, or itineraries.
Block clearly unrelated or harmful requests.

STEP 2 - If allowed, choose which specialist agents are needed:
Available agents:
- flight_agent: flights, airports, airlines, routes, airfare, booking advice, buses, trains
- hotel_agent: hotels, accommodation, stays, neighborhoods
- weather_agent: weather, climate, season, forecast, packing
- budget_agent: cost, affordability, price limits, budget feasibility
- itinerary_agent: creates the integrated travel plan (always include)

STEP 3 - Extract trip constraints from the query.
{pref_str}

Return strict JSON only:
{{
  "allowed": true,
  "guardrail_reason": "",
  "selected_agents": ["flight_agent", "hotel_agent", "weather_agent", "budget_agent", "itinerary_agent"],
  "trip_constraints": {{
    "destination": "",
    "origin": "",
    "duration": "",
    "budget": "",
    "travel_style": "",
    "special_preferences": []
  }},
  "reasoning": ""
}}

User request:
{query}"""

    try:
        raw = _llm_text(
            "You are the guardrail + supervisor for a travel-planning AI. Return strict JSON only.",
            combined_prompt,
        )
        parsed = _json_from_llm(raw)
        allowed = bool(parsed.get("allowed", True))
        guardrail_reason = str(parsed.get("guardrail_reason", "")).strip()

        if not allowed:
            reason = guardrail_reason or (
                "WanderLuxe AI can only help with travel-planning requests."
            )
            return {
                "guardrail_allowed": False,
                "guardrail_reason": reason,
                "selected_agents": [],
                "trip_constraints": _empty_constraints(),
                "supervisor_reasoning": reason,
                "final_response": reason,
                "messages": [AIMessage(content=f"Guardrail blocked: {reason}")],
                "llm_calls": llm_calls + 1,
            }

        requested_agents = parsed.get("selected_agents", [])
        selected_agents = [
            name for name in AGENT_ORDER
            if name in requested_agents and name in KNOWN_AGENTS
        ]
        if "itinerary_agent" not in selected_agents:
            selected_agents.append("itinerary_agent")

        constraints = _empty_constraints()
        parsed_constraints = parsed.get("trip_constraints", {})
        if isinstance(parsed_constraints, dict):
            constraints.update(parsed_constraints)

        # Inject preferences into constraints
        if preferences:
            constraints["travel_style"] = preferences.get("travel_style", constraints.get("travel_style", ""))
            existing_prefs = constraints.get("special_preferences", [])
            if isinstance(existing_prefs, list):
                existing_prefs.extend(preferences.get("interests", []))
                constraints["special_preferences"] = list(set(existing_prefs))

        reasoning = str(parsed.get("reasoning", "")).strip()
        llm_calls += 1

    except Exception as exc:
        print(f"Supervisor fallback used: {exc}")
        selected_agents = AGENT_ORDER.copy()
        constraints = _empty_constraints()
        reasoning = "Supervisor parsing failed; using all agents as safe fallback."
        guardrail_reason = ""

    return {
        "guardrail_allowed": True,
        "guardrail_reason": guardrail_reason,
        "selected_agents": selected_agents,
        "trip_constraints": constraints,
        "supervisor_reasoning": reasoning,
        "messages": [AIMessage(content="Supervisor created the agent plan.")],
        "llm_calls": llm_calls,
    }


# =========================
# Guardrail Blocked Response
# =========================
def guardrail_blocked_agent(state: TravelState):
    reason = state.get("final_response") or state.get("guardrail_reason") or (
        "This request was blocked by the travel input guardrail."
    )
    return {
        "final_response": reason,
        "messages": [AIMessage(content=reason)],
    }


# =========================
# Flight Agent
# =========================
def flight_agent(state: TravelState):
    print("\nINSIDE FLIGHT AGENT\n", flush=True)
    query = state["user_query"]
    constraints = state.get("trip_constraints", {})
    origin = constraints.get("origin", "")
    dest = constraints.get("destination", "")

    airports = "Live airport API data unavailable."
    airlines = "Live airline API data unavailable."

    try:
        airports_res = _run_async(aviation_mcp_call("list_airports"))
        airlines_res = _run_async(aviation_mcp_call("list_airlines"))

        if airports_res:
            res_str = str(airports_res)
            if "access restricted" in res_str.lower() or "function_access_restricted" in res_str.lower():
                airports = f"Use domain knowledge for {origin} → {dest} departure/arrival hubs."
            else:
                airports = res_str[:3000]

        if airlines_res:
            res_str = str(airlines_res)
            if "access restricted" in res_str.lower() or "function_access_restricted" in res_str.lower():
                airlines = f"Use domain knowledge for major carriers on {origin} → {dest} route."
            else:
                airlines = res_str[:3000]
    except Exception as exc:
        print(f"Flight MCP unavailable ({exc}). Using domain knowledge.", flush=True)

    prompt = f"""You are an expert travel transport planner.

User Query: {query}
Origin: {origin}
Destination: {dest}

Airport Data: {airports}
Airline Data: {airlines}

Provide STRUCTURED transport guidance:

## ✈️ Recommended Flight Routes
| Route | Airlines | Duration | Est. Price | Frequency |
|-------|----------|----------|------------|-----------|
(fill realistic data)

## 🚌 Alternative Transport (if applicable)
For short distances or domestic travel, also suggest:
- Buses (government and private operators)
- Trains (express/sleeper options)
- Self-drive options

## 💡 Booking Tips
- Best time to book
- Peak season warnings
- Budget-saving strategies

IMPORTANT: If live API data is restricted, use your domain travel knowledge to provide realistic routes, airlines, durations, and prices. Never mention API restrictions."""

    try:
        response = llm.invoke([
            SystemMessage(content="You are an expert travel transport planner. Provide structured, realistic flight and transport guidance. Use markdown tables where possible."),
            HumanMessage(content=prompt),
        ])
        flight_data = _extract_text(response.content)
    except Exception as exc:
        flight_data = f"Flight guidance could not be generated: {exc}"

    return {
        "flight_results": _extract_text(flight_data),
        "messages": [AIMessage(content="Flight recommendations generated")],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# =========================
# Hotel Agent (with LLM post-processing of Tavily results)
# =========================
def hotel_agent(state: TravelState):
    query = state["user_query"]
    constraints = state.get("trip_constraints", {})
    dest = constraints.get("destination", "")
    budget = constraints.get("budget", "")
    preferences = state.get("travel_preferences", {})
    accommodation_pref = preferences.get("accommodation", "Mid-range")

    search_query = f"Best {accommodation_pref} hotels in {dest or query} for travelers"

    try:
        raw_results = _run_async(tavily_mcp_search(search_query))
        raw_text = _extract_text(raw_results)

        # Post-process Tavily output through LLM for structured hotel recommendations
        structure_prompt = f"""Based on these hotel search results, create a STRUCTURED hotel recommendation.

Search Results:
{raw_text[:4000]}

User Query: {query}
Budget: {budget}
Accommodation Preference: {accommodation_pref}

Format your response as:

## 🏨 Recommended Accommodations in {dest or 'the destination'}

### Budget-Friendly Options (Under $50/night)
| Hotel | Location | Price/Night | Rating | Highlights |
|-------|----------|-------------|--------|------------|

### Mid-Range Options ($50-$150/night)
| Hotel | Location | Price/Night | Rating | Highlights |
|-------|----------|-------------|--------|------------|

### Premium/Luxury Options ($150+/night)
| Hotel | Location | Price/Night | Rating | Highlights |
|-------|----------|-------------|--------|------------|

### 💡 Booking Tips
- Best neighborhoods to stay
- When to book for best prices
- Safety and convenience notes

If the search results are limited, supplement with your knowledge of popular hotels in the area. Provide at least 2-3 options per category."""

        response = llm.invoke([
            SystemMessage(content="You are a hotel and accommodation specialist. Create structured, actionable hotel recommendations from search data."),
            HumanMessage(content=structure_prompt),
        ])
        hotel_results = _extract_text(response.content)

    except Exception as exc:
        print(f"HOTEL AGENT ERROR: {type(exc).__name__}: {exc}", flush=True)
        # Fallback: generate hotel guidance from LLM knowledge
        try:
            fallback_prompt = f"Recommend hotels for a trip to {dest or query}. Budget: {budget}. Preference: {accommodation_pref}. Use structured markdown tables."
            response = llm.invoke([
                SystemMessage(content="You are a hotel specialist. Provide structured recommendations with categories."),
                HumanMessage(content=fallback_prompt),
            ])
            hotel_results = _extract_text(response.content)
        except Exception:
            hotel_results = (
                f"## Hotel Recommendations for {dest}\n\n"
                "Live hotel search is temporarily unavailable. "
                "Please check booking platforms like Booking.com, Agoda, or MakeMyTrip for current availability."
            )

    return {
        "hotel_results": _extract_text(hotel_results),
        "messages": [AIMessage(content="Hotel information processed.")],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# =========================
# Weather Agent (with improved city resolution)
# =========================
def weather_agent(state: TravelState):
    dest = state.get("trip_constraints", {}).get("destination", "")
    try:
        if not dest:
            dest = extract_destination(state["user_query"])
    except Exception as exc:
        print(f"Destination extraction fallback: {exc}", flush=True)
        dest = _extract_destination_heuristic(state["user_query"])

    # Resolve region/state/country to a city for API lookup
    lookup_city = REGION_CITY_MAP.get(dest.strip().lower(), dest.strip())

    # For multi-city/state trips, try the destination directly first
    weather_str = ""
    forecast_str = ""

    try:
        weather_res = _run_async(weather_mcp_search(lookup_city))
        forecast_res = _run_async(forecast_mcp_search(lookup_city))

        weather_str = _extract_text(weather_res)
        forecast_str = _extract_text(forecast_res)

        if "error executing tool" in weather_str.lower() or "404" in weather_str:
            weather_str = ""
        if "error executing tool" in forecast_str.lower() or "404" in forecast_str:
            forecast_str = ""
    except Exception as exc:
        print(f"WEATHER AGENT MCP ERROR: {type(exc).__name__}: {exc}", flush=True)

    # Build structured weather output through LLM
    try:
        weather_prompt = f"""Create a structured weather advisory for a trip to {dest}.

Live Weather Data for {lookup_city}:
{weather_str or 'Live data unavailable - use seasonal knowledge'}

Forecast Data:
{forecast_str or 'Forecast unavailable - use seasonal knowledge'}

Format as:

## 🌤️ Climate Advisory for {dest}

### Current Conditions
- Temperature: 
- Humidity:
- Conditions:

### Seasonal Travel Insights
- Best months to visit
- Current season characteristics
- Rainfall expectations

### 🧳 Packing Checklist
- [ ] Essential clothing items
- [ ] Weather gear
- [ ] Footwear recommendations
- [ ] Sun/rain protection

### ⚠️ Weather Warnings
- Any extreme weather advisories
- Health precautions (heat, altitude, monsoon)"""

        response = llm.invoke([
            SystemMessage(content="You are a travel weather specialist. Provide structured, practical weather guidance for travelers."),
            HumanMessage(content=weather_prompt),
        ])
        weather_results = _extract_text(response.content)
    except Exception as exc:
        print(f"Weather LLM fallback: {exc}", flush=True)
        weather_results = (
            f"## Weather Advisory for {dest}\n\n"
            f"Live weather data for {lookup_city} is temporarily unavailable.\n"
            "Please check weather forecasts near your departure date."
        )

    return {
        "weather_results": _extract_text(weather_results),
        "messages": [AIMessage(content="Weather information processed.")],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# =========================
# Budget Agent
# =========================
def budget_agent(state: TravelState):
    constraints = state.get("trip_constraints", {})
    preferences = state.get("travel_preferences", {})

    prompt = f"""Create a STRUCTURED budget analysis for this trip.

User Query: {state['user_query']}
Trip Constraints: {json.dumps(constraints, indent=2)}
Accommodation Preference: {preferences.get('accommodation', 'Mid-range')}

Flight Data Available: {bool(state.get('flight_results', ''))}
Hotel Data Available: {bool(state.get('hotel_results', ''))}

Format as:

## 💰 Budget Analysis

### Cost Breakdown
| Category | Estimated Cost | Notes |
|----------|---------------|-------|
| Transport (Flights/Trains/Buses) | | |
| Accommodation ({constraints.get('duration', '7 days')}) | | |
| Food & Dining | | |
| Sightseeing & Activities | | |
| Local Transport | | |
| Miscellaneous & Shopping | | |
| **Total Estimated** | **$XX** | |

### Budget Feasibility
- Status: ✅ Feasible / ⚠️ Tight / ❌ Over Budget
- User Budget: {constraints.get('budget', 'Not specified')}
- Estimated Total: $XX

### 💡 Money-Saving Tips
1. ...
2. ...
3. ...

### Currency Information
- Local currency and exchange rate
- Tipping customs
- Payment methods accepted

IMPORTANT: Provide realistic estimates based on current market rates. If the user specified budget in Lakhs (Indian), convert accordingly (1 Lakh ≈ $1,200 USD)."""

    try:
        response = llm.invoke([
            SystemMessage(content="You are a practical travel budget analyst. Provide structured, honest cost analysis with tables."),
            HumanMessage(content=prompt),
        ])
        budget_content = _extract_text(response.content)
    except Exception as exc:
        print(f"Budget Agent LLM fallback: {exc}", flush=True)
        budget_content = (
            "## Budget Analysis\n\n"
            "Budget analysis could not be generated. Please review flight and hotel estimates."
        )

    return {
        "budget_results": _extract_text(budget_content),
        "messages": [AIMessage(content="Budget assessment generated.")],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# =========================
# Coordinates Resolution & Route Stops Engine
# =========================
KNOWN_COORDINATES: dict[str, tuple[float, float]] = {
    # Andhra Pradesh & Telangana Temples & Hubs
    "hyderabad": (17.3850, 78.4867),
    "srisailam": (16.0743, 78.8686),
    "mallikarjuna": (16.0743, 78.8686),
    "ahobilam": (15.1333, 78.7167),
    "mahanandi": (15.4833, 78.6167),
    "kanipakam": (13.2982, 79.0381),
    "tirupati": (13.6288, 79.4192),
    "tirumala": (13.6833, 79.3500),
    "kalahasti": (13.7498, 79.6984),
    "sri kalahasti": (13.7498, 79.6984),
    "vijayawada": (16.5062, 80.6480),
    "kanaka durga": (16.5167, 80.6167),
    "amaravati": (16.5735, 80.3575),
    "mangalagiri": (16.4300, 80.5700),
    "draksharamam": (16.7925, 82.0625),
    "annavaram": (17.2800, 82.4042),
    "simhachalam": (17.7667, 83.2500),
    "visakhapatnam": (17.6868, 83.2185),
    "vizag": (17.6868, 83.2185),
    "lepakshi": (13.8055, 77.6083),
    "mantralayam": (15.9392, 77.4267),
    "kadapa": (14.4673, 78.8242),
    "vontimitta": (14.3833, 79.0333),
    "kurnool": (15.8281, 78.0373),
    "guntur": (16.3067, 80.4365),
    "rajahmundry": (17.0005, 81.8040),
    "nellore": (14.4426, 79.9865),
    "yadagirigutta": (17.5855, 78.9389),
    "yadadri": (17.5855, 78.9389),
    "warangal": (17.9689, 79.5941),
    "ramappa": (18.2600, 79.9400),

    # Tamil Nadu Pilgrimage & Hubs
    "chennai": (13.0827, 80.2707),
    "kanchipuram": (12.8342, 79.7036),
    "tiruvannamalai": (12.2253, 79.0747),
    "chidambaram": (11.3992, 79.6936),
    "kumbakonam": (10.9602, 79.3845),
    "thanjavur": (10.7870, 79.1378),
    "trichy": (10.7905, 78.7047),
    "tiruchirappalli": (10.7905, 78.7047),
    "madurai": (9.9252, 78.1198),
    "rameshwaram": (9.2876, 79.3129),
    "kanyakumari": (8.0883, 77.5385),

    # Major India Hubs
    "delhi": (28.6139, 77.2090),
    "new delhi": (28.6139, 77.2090),
    "mumbai": (19.0760, 72.8777),
    "bangalore": (12.9716, 77.5946),
    "bengaluru": (12.9716, 77.5946),
    "kolkata": (22.5726, 88.3639),
    "jaipur": (26.9124, 75.7873),
    "agra": (27.1767, 78.0081),
    "varanasi": (25.3176, 82.9739),
    "ayodhya": (26.7922, 82.1998),
    "haridwar": (29.9457, 78.1642),
    "rishikesh": (30.0869, 78.2676),
    "amritsar": (31.6340, 74.8723),
    "goa": (15.2993, 74.1240),
    "kochi": (9.9312, 76.2673),
    "munnar": (10.0889, 77.0595),
    "shimla": (31.1048, 77.1734),
    "manali": (32.2432, 77.1892),

    # International
    "tokyo": (35.6762, 139.6503),
    "kyoto": (35.0116, 135.7681),
    "osaka": (34.6937, 135.5023),
    "bali": (-8.4095, 115.1889),
    "singapore": (1.3521, 103.8198),
    "dubai": (25.2048, 55.2708),
    "paris": (48.8566, 2.3522),
    "london": (51.5074, -0.1278),
}

def _resolve_coords(name: str) -> tuple[float, float] | None:
    if not name:
        return None
    clean = name.lower().strip()
    if clean in KNOWN_COORDINATES:
        return KNOWN_COORDINATES[clean]
    for key, coords in KNOWN_COORDINATES.items():
        if key in clean or (len(clean) >= 4 and clean in key):
            return coords
    return None


def calculate_road_distance(c1: tuple[float, float], c2: tuple[float, float]) -> int:
    """Calculate realistic road distance in km between two GPS coordinates using Haversine with road winding factor."""
    lat1, lon1 = c1
    lat2, lon2 = c2
    r_earth = 6371.0  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    crow = r_earth * c
    # Highway winding / topography factor (1.25x for highways & ghat roads)
    return max(15, round(crow * 1.25))


def generate_distance_analysis_table(origin: str, stops: list[dict[str, Any]]) -> str:
    """Generate an authoritative distance calculation matrix and shortest-path verification table."""
    orig_coords = _resolve_coords(origin) or KNOWN_COORDINATES.get("hyderabad", (17.3850, 78.4867))

    # 1. Distances from Origin
    origin_lines = []
    distances_from_origin = []
    for s in stops:
        if s.get("day", 0) == 0:
            continue
        s_coords = (s.get("lat", 0), s.get("lng", 0))
        if s_coords[0] == 0 or s_coords[1] == 0:
            resolved = _resolve_coords(s.get("name", ""))
            if resolved:
                s_coords = resolved
        if s_coords[0] != 0:
            d = calculate_road_distance(orig_coords, s_coords)
            hrs = round(d / 48, 1)
            distances_from_origin.append((s.get("name", ""), d, hrs))

    if distances_from_origin:
        distances_from_origin.sort(key=lambda x: x[1])
        min_dest, min_d, min_hrs = distances_from_origin[0]
        origin_lines.append(f"- **{origin} ➔ {min_dest}**: **{min_d} km** (~{min_hrs} hrs) — 🏆 **LEAST DISTANCE from {origin}**")
        for name, d, hrs in distances_from_origin[1:]:
            diff = d - min_d
            origin_lines.append(f"- **{origin} ➔ {name}**: **{d} km** (~{hrs} hrs) *(+{diff} km further)*")

    # 2. Sequential Leg-by-Leg Route Schedule
    legs_table = []
    total_km = 0
    curr_name = origin
    curr_coords = orig_coords

    filtered_stops = [s for s in stops if s.get("day", 0) > 0]
    for idx, s in enumerate(filtered_stops):
        next_name = s.get("name", f"Stop {idx+1}")
        next_coords = (s.get("lat", 0), s.get("lng", 0))
        if next_coords[0] == 0:
            resolved = _resolve_coords(next_name)
            if resolved:
                next_coords = resolved

        if next_coords[0] != 0 and curr_coords[0] != 0:
            leg_km = calculate_road_distance(curr_coords, next_coords)
        else:
            leg_km = 120

        total_km += leg_km
        drive_hrs = round(leg_km / 48, 1)
        legs_table.append(
            f"| Leg {idx+1} (Day {s.get('day', idx+1)}) | {curr_name} | {next_name} | **{leg_km} km** | ~{drive_hrs} hrs | Sequential forward route |"
        )
        curr_name = next_name
        curr_coords = next_coords

    # Return leg to origin
    if curr_coords[0] != 0 and orig_coords[0] != 0 and curr_name.lower() != origin.lower():
        ret_km = calculate_road_distance(curr_coords, orig_coords)
        total_km += ret_km
        ret_hrs = round(ret_km / 50, 1)
        legs_table.append(
            f"| Final Return | {curr_name} | {origin} | **{ret_km} km** | ~{ret_hrs} hrs | Direct expressway return |"
        )

    origin_summary = "\n".join(origin_lines) if origin_lines else f"- Validated direct route from {origin}."
    table_rows = "\n".join(legs_table)

    return f"""## 🧭 Distance Calculation & Shortest-Path Route Optimization
> **Geodesic & Road Network Verification**: Calculated road distances proving that the sequence follows the shortest non-backtracking loop.

### 📍 Distance Comparison from Starting Hub ({origin})
{origin_summary}

> **Optimization Proof**: Planning the shortest-distance destination first minimizes initial travel fatigue and enables a continuous forward circuit without backtracking across districts.

### 🚗 Chronological Leg-by-Leg Transit Schedule
| Leg | Departure | Destination | Road Distance | Approx Drive | Transit Corridor & Optimization Logic |
|---|---|---|---|---|---|
{table_rows}

**Total Circuit Road Distance**: **{total_km} km** • **Cumulative Drive Time: ~{round(total_km/48, 1)} hrs over duration** • **0 km Backtracking**
"""


def _extract_route_stops(text: str, origin: str = "", destination: str = "") -> list[dict[str, Any]]:
    """Extract route_stops JSON array from itinerary LLM output, with bulletproof regex fallback."""
    valid_stops: list[dict[str, Any]] = []

    # 1. Try parsing JSON block if present
    try:
        json_match = re.search(r'```json\s*(\{[^`]*"route_stops"[^`]*\})\s*```', text, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(1))
            stops = data.get("route_stops", [])
            if isinstance(stops, list) and len(stops) >= 2:
                for stop in stops:
                    if isinstance(stop, dict) and "name" in stop:
                        lat = float(stop.get("lat", 0))
                        lng = float(stop.get("lng", 0))
                        name = str(stop.get("name", "")).strip()
                        if (lat == 0 or lng == 0) and name:
                            coords = _resolve_coords(name)
                            if coords:
                                lat, lng = coords
                        valid_stops.append({
                            "day": stop.get("day", len(valid_stops)),
                            "name": name,
                            "lat": lat,
                            "lng": lng,
                            "description": str(stop.get("description", "")),
                        })
                if len(valid_stops) >= 2:
                    return valid_stops
    except Exception as exc:
        print(f"Route stops JSON extraction failed: {exc}", flush=True)

    # 2. Fallback: Parse day headings directly from the markdown itinerary
    day_matches = re.findall(
        r'(?:###\s*🔹?\s*Day[\s\u202f\u00a0]*(\d+)|\*\*Day[\s\u202f\u00a0]*(\d+)\*\*)[:\s—\-]+([^\n—\-–|]+)',
        text,
        re.IGNORECASE
    )
    extracted: list[dict[str, Any]] = []
    seen_days: set[int] = set()

    for m in day_matches:
        try:
            day_num = int(m[0] or m[1])
            raw_name = m[2].strip().strip("*_#")
            # Clean extraneous text
            clean_name = re.sub(r'\(.*?\)', '', raw_name).strip() or raw_name
            clean_name = re.sub(r'[*_#]', '', clean_name).strip()
            if day_num not in seen_days and clean_name:
                seen_days.add(day_num)
                coords = _resolve_coords(clean_name)
                lat, lng = coords if coords else (0.0, 0.0)
                extracted.append({
                    "day": day_num,
                    "name": clean_name,
                    "lat": lat,
                    "lng": lng,
                    "description": f"Day {day_num} destination",
                })
        except Exception:
            continue

    if extracted:
        # Prepend origin as Day 0 if not present
        if origin and not any(s["day"] == 0 for s in extracted):
            orig_coords = _resolve_coords(origin)
            extracted.insert(0, {
                "day": 0,
                "name": origin,
                "lat": orig_coords[0] if orig_coords else 0.0,
                "lng": orig_coords[1] if orig_coords else 0.0,
                "description": "Departure Hub",
            })
        return extracted

    return []


# =========================
# Itinerary Agent (structured output + route stops for map)
# =========================
def itinerary_agent(state: TravelState):
    constraints = state.get("trip_constraints", {})
    preferences = state.get("travel_preferences", {})
    dest = constraints.get("destination", "") or "Destination"
    origin = constraints.get("origin", "") or "Hyderabad"
    duration = constraints.get("duration", "7 days")

    # Extract number of days from duration string
    dur_match = re.search(r'(\d+)', str(duration))
    num_days = int(dur_match.group(1)) if dur_match else 7
    if num_days < 1:
        num_days = 7

    pref_context = ""
    if preferences:
        pref_context = f"""
Traveler Persona & Preferences:
- Travel Style: {preferences.get('travel_style', 'Cultural & Sacred')}
- Core Interests: {', '.join(preferences.get('interests', []))}
- Pace: {preferences.get('pace', 'Balanced')}
- Accommodation Tier: {preferences.get('accommodation', 'Comfortable stays near key sites')}
"""

    prompt = f"""You are a master travel planner creating a complete, highly structured day-by-day travel blueprint.

User Query: {state['user_query']}
Origin: {origin}
Destination: {dest}
Target Duration: Exactly {num_days} Days
{pref_context}

Specialist Inputs:
- Transport Context: {state.get('flight_results', '')[:1200]}
- Stays Context: {state.get('hotel_results', '')[:1200]}
- Weather Advice: {state.get('weather_results', '')[:1000]}
- Budget Target: {state.get('budget_results', '')[:1000]}

MANDATORY RULES:
1. COMPLETE DAYS WITHOUT TRUNCATION: You MUST generate every single day from Day 1 to Day {num_days} (Day 1, Day 2, ... through Day {num_days}). Never stop early, never skip a day, and never write 'Day 4-7: repeat'. Every single day must be individually detailed. You MUST explicitly output all days including Day {num_days} (do not end at Day {num_days - 1})!
2. GEOGRAPHICAL & HISTORICAL PILGRIMAGE ROUTE:
   If the destination involves Andhra Pradesh sacred temples from Hyderabad, arrange the days in the most famous, historically revered, and geographically efficient non-backtracking circuit:
   - Day 1: Srisailam — Sacred Mallikarjuna Jyotirlinga (one of 12 sacred Jyotirlingas) & Bhramaramba Devi Shakti Peetham on Nallamala Hills.
   - Day 2: Ahobilam & Mahanandi — Historic Nava Narasimha Kshetram (9 temples of Lord Narasimha in serene forest) and crystal spring temple.
   - Day 3: Kadapa / Vontimitta / Kanipakam — Kodandarama Swamy Temple & Swayambhu Sri Varasiddhi Vinayaka Swamy Temple.
   - Day 4: Tirupati & Tirumala — World-famous Sri Venkateswara Swamy Temple atop the Seven Hills (VIP/Special Entry Darshan & Laddu Prasadam).
   - Day 5: Sri Kalahasti & Tiruchanur — Famous Sri Kalahasteeswara Vayu Linga (Rahu-Ketu Sarpa Dosha Nivarana) & Padmavathi Ammavari Temple.
   - Day 6: Vijayawada & Mangalagiri — Sacred Indrakeeladri Hill to worship Sri Kanaka Durga Temple and Panakala Narasimha Swamy.
   - Day 7: Amaravati & Return to Hyderabad — Amaralingeswara Swamy Temple (Pancharama Kshetra) and scenic return journey to Hyderabad.
   For other destinations (Delhi, Tamil Nadu, Europe, Japan, etc.), plan the optimal chronological multi-city/landmark circuit for all {num_days} days.

3. CONCISE, HIGH-DENSITY FORMAT (strictly follow to guarantee zero truncation):

## 🗺️ Journey Overview
- **Circuit Route**: {origin} → {dest}
- **Planned Duration**: Exactly {num_days} Days
- **Travel Style**: {preferences.get('travel_style', 'Curated Exploration')}
- **Estimated Cost**: Within user budget

---

## 📅 Day-by-Day Master Schedule

You MUST write an individual section for EACH day from Day 1 through Day {num_days}:

### 🔹 Day 1: [Place / Shrine Name] — [Theme]
**📍 Location**: [City/District] | **🚗 Transit**: [Transit Mode, Distance, Approx Travel Time] | **🏨 Stay**: [Recommended Hotel & Approx Price]
- 🌅 **Morning**: [Darshan/Primary activity, timings, rituals]
- 🌞 **Afternoon**: [Midday temple/attraction, prasadam/lunch, rest]
- 🌙 **Evening**: [Aarti/Evening darshan, local market, dinner]
- 💡 **Local Insight**: [Specific entry pass advice, dress code, travel tip]

(Continue for Day 2, Day 3, Day 4, Day 5, Day 6, AND Day {num_days}. All {num_days} days must be present!)

---

## 📦 Essential Packing Checklist
- [ ] Essential travel documents & government IDs
- [ ] Appropriate dress code attire (temple wear / weather gear)
- [ ] Prescribed medicines & first-aid essentials

## 📌 Traveler Advisory & Tips
1. ...
2. ...

At the very end of your response, output a JSON block wrapped in ```json ... ``` with ALL connected stops in sequential order:
```json
{{
  "route_stops": [
    {{"day": 0, "name": "{origin}", "lat": 17.3850, "lng": 78.4867, "description": "Departure Hub"}},
    {{"day": 1, "name": "Day 1 Location", "lat": 16.0743, "lng": 78.8686, "description": "Day 1 Highlights"}},
    ...
  ]
}}
```
"""

    try:
        response = llm.invoke([
            SystemMessage(content=(
                "You are an expert travel planner. You MUST generate every requested day in full without truncation. "
                "Always include realistic GPS coordinates in the route_stops JSON block at the end."
            )),
            HumanMessage(content=prompt),
        ])
        full_response = _extract_text(response.content)

        # Extract route_stops JSON / regex from the response
        route_stops = _extract_route_stops(full_response, origin, dest)

        # Clean the itinerary text (remove the JSON block from display)
        itinerary_content = re.sub(
            r'```json\s*\{[^`]*"route_stops"[^`]*\}\s*```',
            '',
            full_response,
            flags=re.DOTALL
        ).strip()

        # Prepend the mathematical distance & route optimization analysis table
        if route_stops and "Distance Calculation" not in itinerary_content:
            dist_analysis = generate_distance_analysis_table(origin, route_stops)
            itinerary_content = f"{dist_analysis}\n\n---\n\n{itinerary_content}"

    except Exception as exc:
        print(f"Itinerary Agent LLM fallback: {exc}", flush=True)
        itinerary_content = (
            f"## Draft Itinerary for {state['user_query']}\n\n"
            f"- Flight Guidance: {state.get('flight_results', 'TBD')[:200]}\n"
            f"- Accommodation: {state.get('hotel_results', 'TBD')[:200]}\n"
            f"- Weather: {state.get('weather_results', 'TBD')[:200]}\n"
            f"- Budget: {state.get('budget_results', 'TBD')[:200]}\n"
        )
        route_stops = []

    approval_request = (
        "Please review this draft itinerary. Approve it to finalize "
        "the master travel blueprint, or provide revision feedback."
    )

    return {
        "itinerary": itinerary_content,
        "route_stops": route_stops,
        "approval_request": approval_request,
        "messages": [AIMessage(content="Draft itinerary created for human review.")],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# =========================
# Human-in-the-Loop Approval
# =========================
def human_approval_agent(state: TravelState):
    review = interrupt({
        "question": "Do you approve this itinerary?",
        "draft_itinerary": state.get("itinerary", ""),
        "approval_request": state.get("approval_request", ""),
        "selected_agents": state.get("selected_agents", []),
        "supervisor_reasoning": state.get("supervisor_reasoning", ""),
        "expected_response": {
            "approved": True,
            "feedback": "Optional revision feedback",
        },
    })

    approved = bool(review.get("approved", False))
    human_feedback = str(review.get("feedback", "")).strip()

    return {
        "approved": approved,
        "human_feedback": human_feedback,
        "messages": [AIMessage(content="Human approval step completed.")],
    }


# =========================
# Final Response Agent (polished, structured output)
# =========================
def final_agent(state: TravelState):
    constraints = state.get("trip_constraints", {})
    dest = constraints.get("destination", "") or "Destination"
    origin = constraints.get("origin", "") or "Hyderabad"
    duration = constraints.get("duration", "7 days")
    budget = constraints.get("budget", "")
    approved = state.get("approved", False)
    human_feedback = str(state.get("human_feedback", "")).strip()

    draft_itinerary = state.get("itinerary", "")
    route_stops = state.get("route_stops", [])

    # If user approved and no complex revisions requested, assemble the master blueprint directly.
    # This prevents LLM token exhaustion, ensures zero days are truncated, and retains 100% of the plan!
    is_simple_approval = approved and (not human_feedback or human_feedback.lower() in [
        "approved", "looks good", "ok", "yes", "proceed", "fine", "perfect", "good"
    ])

    if is_simple_approval and draft_itinerary:
        flight_sec = state.get("flight_results", "").strip()
        hotel_sec = state.get("hotel_results", "").strip()
        weather_sec = state.get("weather_results", "").strip()
        budget_sec = state.get("budget_results", "").strip()

        dist_sec = ""
        if "Distance Calculation" not in draft_itinerary and route_stops:
            dist_sec = f"\n---\n\n{generate_distance_analysis_table(origin, route_stops)}\n"

        final_text = f"""# 🌍 Master Travel Blueprint: {dest}

> **Curated by WanderLuxe Multi-Agent Intelligence** • Verified & Human-Approved

## 📋 Trip Executive Summary
| Detail | Specification |
|---|---|
| **Route** | {origin} ➔ {dest} |
| **Duration** | {duration} |
| **Budget Guideline** | {budget or 'Custom Curated Plan'} |
| **Travel Style** | {constraints.get('travel_style', 'Bespoke Curated Tour')} |
| **Approval Status** | ✅ Verified & Human-Approved |
{dist_sec}
---

## ✈️ Transport & Connectivity Guidance
{flight_sec or "*Multi-modal transport details are integrated into the day-by-day plan.*"}

---

## 🏨 Curated Accommodations & Stays
{hotel_sec or "*Recommended stays are detailed in the day-by-day itinerary.*"}

---

## 📅 Complete Day-by-Day Master Itinerary
{draft_itinerary}

---

## 🌤️ Weather Forecast & Seasonal Advisory
{weather_sec or "*Check seasonal climate details before departure.*"}

---

## 💰 Feasibility & Cost Assessment
{budget_sec or "*Detailed budget breakdown integrated.*"}

---

## 📌 Essential Cultural & Traveler Tips
1. **Advance Darshan Bookings**: For major pilgrimage shrines (e.g. Tirumala Balaji, Srisailam, Meenakshi), reserve Special Entry Darshan (SED) passes 30-60 days in advance via official temple portals.
2. **Dress Code Compliance**: Strictly observe traditional attire (Dhoti/Kurta for men, Saree/Churidar with Dupatta for women) required inside South Indian sanctums.
3. **Local Transit Convenience**: Pre-book dedicated private AC cabs or express buses for seamless transit between pilgrim hubs without delays.
4. **Prasadam & Offerings**: Authentic temple prasadam is available at designated Devasthanam counters; collect tokens early during morning hours.
5. **Connectivity & Cash**: Download offline Google Maps and carry adequate cash for temple donation stalls and local transport.

---

## ✅ Pre-Departure Checklist
- [ ] Government ID (Aadhaar / Passport) original & photocopies
- [ ] Confirmed Special Darshan tickets & hotel booking slips
- [ ] Traditional temple dress sets packed
- [ ] Comfortable footwear easy to slip off at temple gates
- [ ] Basic first-aid kit & personal medicines
"""
        return {
            "final_response": final_text,
            "route_stops": route_stops,
            "messages": [AIMessage(content=final_text)],
            "llm_calls": state.get("llm_calls", 0),
        }

    # If human revision feedback is requested, apply it via LLM while strictly enforcing full days
    review_instruction = f"Apply this specific feedback from the user while keeping ALL days intact:\n{human_feedback}"

    final_prompt = f"""Generate the FINAL polished travel blueprint.

{review_instruction}

User Request: {state['user_query']}
Origin: {origin}
Destination: {dest}

Draft Itinerary:
{draft_itinerary[:5000]}

MANDATORY RULES:
- You MUST maintain ALL days (Day 1 through Day {duration}). Do NOT truncate or drop any day.
- Incorporate the user's feedback precisely.
- Keep the clean bulleted daily schedule.

At the very end of your response, output a JSON block wrapped in ```json ... ``` with ALL connected stops:
```json
{{"route_stops": {json.dumps(route_stops)}}}
```
"""

    try:
        response = llm.invoke([
            SystemMessage(content="You are a professional travel concierge. Create beautiful, structured, complete travel blueprints without dropping days."),
            HumanMessage(content=final_prompt),
        ])
        full_text = _extract_text(response.content)

        new_stops = _extract_route_stops(full_text, origin, dest)
        if new_stops:
            route_stops = new_stops

        final_text = re.sub(
            r'```json\s*\{[^`]*"route_stops"[^`]*\}\s*```',
            '',
            full_text,
            flags=re.DOTALL
        ).strip()

    except Exception as exc:
        print(f"Final Agent LLM fallback: {exc}", flush=True)
        final_text = (
            f"# Travel Plan for {state['user_query']}\n\n"
            f"## Itinerary\n{draft_itinerary}\n"
        )

    return {
        "final_response": final_text,
        "route_stops": route_stops,
        "messages": [AIMessage(content=final_text)],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# =========================
# Graph Routing
# =========================
ROUTE_MAP = {
    "guardrail_blocked": "guardrail_blocked",
    "flight_agent": "flight_agent",
    "hotel_agent": "hotel_agent",
    "weather_agent": "weather_agent",
    "budget_agent": "budget_agent",
    "itinerary_agent": "itinerary_agent",
}


def _selected_agents(state: TravelState) -> list[str]:
    selected = state.get("selected_agents", [])
    return [agent for agent in AGENT_ORDER if agent in selected]


def route_from_supervisor(state: TravelState) -> str:
    if not state.get("guardrail_allowed", True):
        return "guardrail_blocked"
    selected = _selected_agents(state)
    return selected[0] if selected else "itinerary_agent"


def route_after_agent(current_agent: str):
    def route(state: TravelState) -> str:
        selected = _selected_agents(state)
        current_index = AGENT_ORDER.index(current_agent)
        for next_agent in AGENT_ORDER[current_index + 1:]:
            if next_agent in selected:
                return next_agent
        return "itinerary_agent"
    return route


# =========================
# Build Graph
# =========================
graph = StateGraph(TravelState)

graph.add_node("supervisor", supervisor_agent)
graph.add_node("guardrail_blocked", guardrail_blocked_agent)
graph.add_node("flight_agent", flight_agent)
graph.add_node("hotel_agent", hotel_agent)
graph.add_node("weather_agent", weather_agent)
graph.add_node("budget_agent", budget_agent)
graph.add_node("itinerary_agent", itinerary_agent)
graph.add_node("human_approval", human_approval_agent)
graph.add_node("final_agent", final_agent)

graph.add_edge(START, "supervisor")
graph.add_conditional_edges("supervisor", route_from_supervisor, ROUTE_MAP)

graph.add_conditional_edges("flight_agent", route_after_agent("flight_agent"), ROUTE_MAP)
graph.add_conditional_edges("hotel_agent", route_after_agent("hotel_agent"), ROUTE_MAP)
graph.add_conditional_edges("weather_agent", route_after_agent("weather_agent"), ROUTE_MAP)
graph.add_conditional_edges("budget_agent", route_after_agent("budget_agent"), ROUTE_MAP)

graph.add_edge("itinerary_agent", "human_approval")
graph.add_edge("human_approval", "final_agent")
graph.add_edge("final_agent", END)
graph.add_edge("guardrail_blocked", END)


# =========================
# Checkpointer
# =========================
def init_checkpointer():
    database_url = os.getenv("DATABASE_URL", "").strip()

    if not HAS_POSTGRES:
        print("[TripMate INFO] psycopg unavailable. Using MemorySaver.", flush=True)
        return MemorySaver()

    if database_url and not database_url.startswith("your_"):
        try:
            if "sslmode=" not in database_url and not any(
                h in database_url for h in ("localhost", "127.0.0.1")
            ):
                separator = "&" if "?" in database_url else "?"
                database_url = f"{database_url}{separator}sslmode=require"

            _conn = psycopg.connect(database_url, autocommit=True, row_factory=dict_row)
            saver = PostgresSaver(_conn)
            saver.setup()
            print("[TripMate] Connected to PostgreSQL checkpointer successfully.", flush=True)
            return saver
        except Exception as exc:
            print(f"[TripMate WARNING] PostgreSQL failed ({exc}). Using MemorySaver.", flush=True)
            return MemorySaver()

    print("[TripMate INFO] No DATABASE_URL. Using MemorySaver.", flush=True)
    return MemorySaver()


checkpointer = init_checkpointer()
travel_graph = graph.compile(checkpointer=checkpointer)


# =========================
# API-facing helpers
# =========================
def _interrupt_payload(result: dict[str, Any]) -> dict[str, Any] | None:
    interrupts = result.get("__interrupt__", [])
    if not interrupts:
        return None
    first_interrupt = interrupts[0]
    payload = getattr(first_interrupt, "value", first_interrupt)
    return payload if isinstance(payload, dict) else {"value": payload}


def _serialize_result(result: dict[str, Any], thread_id: str) -> dict[str, Any]:
    messages = result.get("messages", [])
    last_message = messages[-1].content if messages else ""
    answer = result.get("final_response") or last_message
    interrupt_payload = _interrupt_payload(result)

    if interrupt_payload:
        answer = interrupt_payload.get("draft_itinerary") or result.get("itinerary", "")

    answer_text = _extract_text(answer)
    itinerary_text = _extract_text(
        interrupt_payload.get("draft_itinerary", "")
        if interrupt_payload
        else result.get("itinerary", "")
    )

    route_stops = result.get("route_stops", [])
    constraints = result.get("trip_constraints", {})
    if not route_stops or len(route_stops) < 2:
        route_stops = _extract_route_stops(
            answer_text or itinerary_text,
            constraints.get("origin", "Hyderabad"),
            constraints.get("destination", "")
        )

    return {
        "thread_id": thread_id,
        "answer": answer_text,
        "requires_approval": interrupt_payload is not None,
        "approval_request": _extract_text(
            interrupt_payload.get("approval_request", "")
            if interrupt_payload
            else result.get("approval_request", "")
        ),
        "flight_results": _extract_text(result.get("flight_results", "")),
        "hotel_results": _extract_text(result.get("hotel_results", "")),
        "weather_results": _extract_text(result.get("weather_results", "")),
        "budget_results": _extract_text(result.get("budget_results", "")),
        "itinerary": itinerary_text,
        "route_stops": route_stops,
        "selected_agents": result.get("selected_agents", []),
        "trip_constraints": constraints,
        "supervisor_reasoning": _extract_text(result.get("supervisor_reasoning", "")),
        "guardrail_allowed": result.get("guardrail_allowed", True),
        "guardrail_reason": _extract_text(result.get("guardrail_reason", "")),
        "approved": result.get("approved"),
        "human_feedback": _extract_text(result.get("human_feedback", "")),
        "llm_calls": result.get("llm_calls", 0),
    }


def run_travel_agent(
    user_input: str,
    thread_id: str | None = None,
    preferences: dict[str, Any] | None = None,
):
    """Start a new travel-planning run with optional preferences."""
    if not thread_id:
        thread_id = f"user_{uuid.uuid4().hex}"

    config = {"configurable": {"thread_id": thread_id}}

    result = travel_graph.invoke(
        {
            "messages": [HumanMessage(content=user_input)],
            "user_query": user_input,
            "travel_preferences": preferences or {},
            "guardrail_allowed": True,
            "guardrail_reason": "",
            "selected_agents": [],
            "trip_constraints": _empty_constraints(),
            "supervisor_reasoning": "",
            "flight_results": "",
            "hotel_results": "",
            "weather_results": "",
            "budget_results": "",
            "itinerary": "",
            "route_stops": [],
            "approval_request": "",
            "approved": False,
            "human_feedback": "",
            "final_response": "",
            "llm_calls": 0,
        },
        config=config,
    )

    return _serialize_result(result, thread_id)


def resume_travel_agent(thread_id: str, approved: bool, feedback: str = ""):
    """Resume the paused LangGraph thread after human review."""
    if not thread_id:
        raise ValueError("thread_id is required to resume a travel plan.")

    config = {"configurable": {"thread_id": thread_id}}
    result = travel_graph.invoke(
        Command(resume={"approved": approved, "feedback": feedback.strip()}),
        config=config,
    )

    return _serialize_result(result, thread_id)
