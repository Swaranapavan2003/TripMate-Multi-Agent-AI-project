/**
 * WanderLuxe AI — Autonomous Multi-Agent Travel Intelligence Platform
 * Client Application Engine with Leaflet Connected Route Maps & Mood Analyzer
 */

let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";
let waitingForApproval = false;
let currentDataPayload = null;
let currentAgentSlideIndex = 0;

// Active Leaflet map instances
let activeInlineMap = null;
let activeDedicatedMap = null;

// Traveler Mood & Preferences State
let currentPreferences = {
  mood: "spiritual",
  travel_style: "Spiritual & Sacred Temples",
  interests: ["Sacred temples & divine darshans", "Morning temple rituals", "Clean stays near temple gates"],
  companion: "family",
  pace: "balanced",
  transit: "all",
  accommodation: "Comfortable stays near landmarks"
};

const MOOD_DATA = {
  spiritual: {
    style: "Spiritual & Sacred Temples",
    interests: ["Sacred temples & divine darshans", "Morning temple rituals", "Clean stays near temple gates"],
    promptSuffix: " Focus on famous sacred temples, morning darshan timings, temple stays, and transport connections."
  },
  mountain: {
    style: "Mountains & Serenity",
    interests: ["Scenic mountain peaks", "Pine valleys & hiking", "Tranquil lakes & viewpoints"],
    promptSuffix: " Focus on scenic mountain viewpoints, nature walks, serene chalets/resorts, and weather-aware advice."
  },
  beach: {
    style: "Beaches & Islands",
    interests: ["Turquoise waters & swimming", "Coastal boat rides & sunsets", "Water villas & seafood dining"],
    promptSuffix: " Focus on beautiful beaches, island hopping, coastal resorts, and relaxing sunset spots."
  },
  heritage: {
    style: "Heritage & Forts",
    interests: ["Ancient forts & royal palaces", "UNESCO heritage sites", "Cultural dynasties & architecture"],
    promptSuffix: " Focus on historic monuments, royal architecture, guided heritage walks, and cultural traditions."
  },
  adventure: {
    style: "Thrill & Adventure",
    interests: ["Wildlife safaris & trekking", "River rafting & watersports", "Off-road scenic trails"],
    promptSuffix: " Focus on adventure activities, trekking routes, safari bookings, and outdoor exploration."
  },
  wellness: {
    style: "Wellness & Spas",
    interests: ["Ayurvedic healing & yoga", "Luxury private pool villas", "Spa treatments & slow travel"],
    promptSuffix: " Focus on serene wellness retreats, private luxury villas, yoga shalas, and rejuvenating experiences."
  }
};

// Geocoding Coordinates Dictionary for Indian & International Destinations
const KNOWN_COORDINATES = {
  // Andhra Pradesh & Telangana Temples & Hubs
  "hyderabad": [17.3850, 78.4867],
  "srisailam": [16.0743, 78.8686],
  "mallikarjuna": [16.0743, 78.8686],
  "ahobilam": [15.1333, 78.7167],
  "mahanandi": [15.4833, 78.6167],
  "kanipakam": [13.2982, 79.0381],
  "tirupati": [13.6288, 79.4192],
  "tirumala": [13.6833, 79.3500],
  "kalahasti": [13.7498, 79.6984],
  "sri kalahasti": [13.7498, 79.6984],
  "vijayawada": [16.5062, 80.6480],
  "kanaka durga": [16.5167, 80.6167],
  "amaravati": [16.5735, 80.3575],
  "mangalagiri": [16.4300, 80.5700],
  "draksharamam": [16.7925, 82.0625],
  "annavaram": [17.2800, 82.4042],
  "simhachalam": [17.7667, 83.2500],
  "visakhapatnam": [17.6868, 83.2185],
  "vizag": [17.6868, 83.2185],
  "lepakshi": [13.8055, 77.6083],
  "mantralayam": [15.9392, 77.4267],
  "kadapa": [14.4673, 78.8242],
  "vontimitta": [14.3833, 79.0333],
  "kurnool": [15.8281, 78.0373],
  "guntur": [16.3067, 80.4365],
  "rajahmundry": [17.0005, 81.8040],
  "nellore": [14.4426, 79.9865],
  "yadagirigutta": [17.5855, 78.9389],
  "yadadri": [17.5855, 78.9389],
  "warangal": [17.9689, 79.5941],
  "ramappa": [18.2600, 79.9400],

  // Tamil Nadu Pilgrimage & Hubs
  "chennai": [13.0827, 80.2707],
  "kanchipuram": [12.8342, 79.7036],
  "tiruvannamalai": [12.2253, 79.0747],
  "chidambaram": [11.3992, 79.6936],
  "kumbakonam": [10.9602, 79.3845],
  "thanjavur": [10.7870, 79.1378],
  "trichy": [10.7905, 78.7047],
  "tiruchirappalli": [10.7905, 78.7047],
  "madurai": [9.9252, 78.1198],
  "rameshwaram": [9.2876, 79.3129],
  "kanyakumari": [8.0883, 77.5385],

  // India Major Hubs
  "delhi": [28.6139, 77.2090],
  "new delhi": [28.6139, 77.2090],
  "mumbai": [19.0760, 72.8777],
  "bangalore": [12.9716, 77.5946],
  "bengaluru": [12.9716, 77.5946],
  "kolkata": [22.5726, 88.3639],
  "jaipur": [26.9124, 75.7873],
  "agra": [27.1767, 78.0081],
  "varanasi": [25.3176, 82.9739],
  "ayodhya": [26.7922, 82.1998],
  "haridwar": [29.9457, 78.1642],
  "rishikesh": [30.0869, 78.2676],
  "amritsar": [31.6340, 74.8723],
  "goa": [15.2993, 74.1240],
  "kochi": [9.9312, 76.2673],
  "munnar": [10.0889, 77.0595],
  "shimla": [31.1048, 77.1734],
  "manali": [32.2432, 77.1892],

  // International Hubs
  "tokyo": [35.6762, 139.6503],
  "kyoto": [35.0116, 135.7681],
  "osaka": [34.6937, 135.5023],
  "mount fuji": [35.3606, 138.7274],
  "fuji": [35.3606, 138.7274],
  "bali": [-8.4095, 115.1889],
  "ubud": [-8.5069, 115.2625],
  "nusa penida": [-8.7278, 115.5444],
  "denpasar": [-8.6705, 115.2126],
  "singapore": [1.3521, 103.8198],
  "dubai": [25.2048, 55.2708],
  "paris": [48.8566, 2.3522],
  "rome": [41.9028, 12.4964],
  "positano": [40.6281, 14.4850],
  "amalfi": [40.6340, 14.6027],
  "zurich": [47.3769, 8.5417],
  "zermatt": [45.9765, 7.7491],
  "reykjavik": [64.1466, -21.9426],
  "bangkok": [13.7563, 100.5018],
  "london": [51.5074, -0.1278]
};

const AGENT_SLIDES = [
  "flight",
  "hotel",
  "weather",
  "budget",
  "supervisor",
  "hitl"
];

const AGENT_META = {
  flight_agent: {
    name: "SkyScout Transport Specialist",
    icon: "fa-plane-departure",
    desc: "AviationStack & Interstate Rail/Bus Routing"
  },
  hotel_agent: {
    name: "Oasis Stays Specialist",
    icon: "fa-hotel",
    desc: "Tavily Real-Time Web Discovery"
  },
  weather_agent: {
    name: "Climate Intelligence Agent",
    icon: "fa-cloud-sun",
    desc: "FastMCP Climate & Microforecasts"
  },
  budget_agent: {
    name: "Cost Architect Agent",
    icon: "fa-coins",
    desc: "Currency & Spending Feasibility"
  },
  itinerary_agent: {
    name: "Master Blueprint Synthesizer",
    icon: "fa-calendar-day",
    desc: "Harmonized Day-by-Day Master Plan & GPS Map"
  }
};

/**
 * Robust string extractor to guarantee marked.parse never receives an array or object
 */
function toMarkdownString(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (Array.isArray(val)) {
    return val
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          if (item.text) return item.text;
          if (item.content) return item.content;
          return JSON.stringify(item);
        }
        return String(item);
      })
      .join("\n\n");
  }
  if (typeof val === "object") {
    if (val.text) return val.text;
    if (val.content) return val.content;
    return JSON.stringify(val, null, 2);
  }
  return String(val);
}

function renderMarkdown(element, markdown) {
  if (!element) return;
  const str = toMarkdownString(markdown) || "*No details available.*";
  if (typeof marked !== "undefined" && typeof marked.parse === "function") {
    try {
      element.innerHTML = marked.parse(str);
    } catch (e) {
      console.warn("marked.parse fallback:", e);
      element.innerText = str;
    }
  } else {
    element.innerText = str;
  }
}

// Traveler Mood Selector
function selectMood(moodKey) {
  document.querySelectorAll(".mood-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.mood === moodKey);
  });

  const moodInfo = MOOD_DATA[moodKey] || MOOD_DATA.spiritual;
  currentPreferences.mood = moodKey;
  currentPreferences.travel_style = moodInfo.style;
  currentPreferences.interests = moodInfo.interests;
}

// Traveler Companion / Pace / Transit Selector
function selectPref(category, val, el) {
  if (!el) return;
  const parent = el.parentElement;
  if (parent) {
    parent.querySelectorAll(".pref-tag-chip").forEach((chip) => chip.classList.remove("active"));
  }
  el.classList.add("active");

  if (category === "companion") currentPreferences.companion = val;
  if (category === "pace") currentPreferences.pace = val;
  if (category === "transit") currentPreferences.transit = val;
}

// Mode switcher: Freeform Prompt vs Structured Trip Builder
function switchInputMode(mode) {
  const freeformArea = document.getElementById("freeformArea");
  const builderArea = document.getElementById("builderArea");
  const tabFreeform = document.getElementById("tabFreeform");
  const tabBuilder = document.getElementById("tabBuilder");

  if (!freeformArea || !builderArea) return;

  if (mode === "builder") {
    freeformArea.classList.add("hidden");
    builderArea.classList.remove("hidden");
    tabFreeform?.classList.remove("active");
    tabBuilder?.classList.add("active");
  } else {
    builderArea.classList.add("hidden");
    freeformArea.classList.remove("hidden");
    tabBuilder?.classList.remove("active");
    tabFreeform?.classList.add("active");
  }
}

// Assemble prompt from Structured Journey Builder
function assemblePromptFromBuilder() {
  const origin = document.getElementById("builderOrigin")?.value.trim() || "Hyderabad";
  const dest = document.getElementById("builderDest")?.value.trim() || "Andhra Pradesh";
  const duration = document.getElementById("builderDuration")?.value || "7 days";
  const budget = document.getElementById("builderBudget")?.value.trim() || "40,000 INR";

  const styles = [];
  document.querySelectorAll("input[name='style']:checked").forEach((chk) => {
    styles.push(chk.value);
  });
  const styleStr = styles.length > 0 ? ` Focusing on ${styles.join(", ")}.` : "";

  const assembled = `Plan a complete ${duration} trip to ${dest} from ${origin} under ${budget}.${styleStr} Include flight, train and AC bus transport options, hotel stays, daily schedule, and a connected route map.`;
  
  const userInput = document.getElementById("userInput");
  if (userInput) {
    userInput.value = assembled;
  }
  switchInputMode("freeform");
  return assembled;
}

function assembleAndSend() {
  assemblePromptFromBuilder();
  sendMessage();
}

// Destination Cards & Preset Prompts Click Handler
function setPrompt(text) {
  const input = document.getElementById("userInput");
  if (!input) return;
  
  switchInputMode("freeform");
  input.value = text;
  input.focus();

  const planner = document.getElementById("plannerSection");
  if (planner) {
    planner.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Flash highlight effect on input container
  const box = document.querySelector(".prompt-input-container");
  if (box) {
    box.classList.add("highlight-pulse");
    setTimeout(() => box.classList.remove("highlight-pulse"), 1200);
  }
}

// Quick append to Human-in-the-Loop feedback
function appendFeedback(text) {
  const feedbackInput = document.getElementById("approvalFeedback");
  if (!feedbackInput) return;

  if (feedbackInput.value.trim().length > 0) {
    feedbackInput.value += ` ${text}`;
  } else {
    feedbackInput.value = text;
  }
  feedbackInput.focus();
}

// Interactive Agent Fleet Slide Showcase
function selectAgentSlide(agentKey) {
  const idx = AGENT_SLIDES.indexOf(agentKey);
  if (idx !== -1) {
    currentAgentSlideIndex = idx;
  }

  // Update nav buttons
  document.querySelectorAll(".fleet-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.agent === agentKey);
  });

  // Toggle slide detail panes
  document.querySelectorAll(".fleet-slide-pane").forEach((pane) => {
    pane.classList.add("hidden");
  });

  const slideMap = {
    flight: "slideFlight",
    hotel: "slideHotel",
    weather: "slideWeather",
    budget: "slideBudget",
    supervisor: "slideSupervisor",
    hitl: "slideHitl"
  };

  const targetId = slideMap[agentKey] || "slideFlight";
  const targetPane = document.getElementById(targetId);
  if (targetPane) {
    targetPane.classList.remove("hidden");
    targetPane.classList.add("fade-in");
  }
}

function nextAgentSlide() {
  currentAgentSlideIndex = (currentAgentSlideIndex + 1) % AGENT_SLIDES.length;
  selectAgentSlide(AGENT_SLIDES[currentAgentSlideIndex]);
}

function prevAgentSlide() {
  currentAgentSlideIndex = (currentAgentSlideIndex - 1 + AGENT_SLIDES.length) % AGENT_SLIDES.length;
  selectAgentSlide(AGENT_SLIDES[currentAgentSlideIndex]);
}

// FAQ Accordion
function toggleFaq(faqId) {
  const answer = document.getElementById(faqId);
  const icon = document.getElementById(`${faqId}-icon`);
  if (!answer) return;

  const isHidden = answer.classList.contains("hidden");
  if (isHidden) {
    answer.classList.remove("hidden");
    if (icon) icon.className = "fa-solid fa-chevron-up";
  } else {
    answer.classList.add("hidden");
    if (icon) icon.className = "fa-solid fa-chevron-down";
  }
}

// Concierge Inquiry Form
function submitInquiry(event) {
  if (event) event.preventDefault();
  const name = document.getElementById("contactName")?.value.trim() || "";
  const email = document.getElementById("contactEmail")?.value.trim() || "";
  const msg = document.getElementById("contactMessage")?.value.trim() || "";

  if (!email || !msg) {
    alert("Please provide your email address and trip inquiry message.");
    return;
  }

  alert(`Thank you, ${name || "Traveler"}! Your custom travel inquiry has been routed to our Travel Concierge team. We will email you at ${email} within 24 hours.`);
  
  if (document.getElementById("contactName")) document.getElementById("contactName").value = "";
  if (document.getElementById("contactEmail")) document.getElementById("contactEmail").value = "";
  if (document.getElementById("contactMessage")) document.getElementById("contactMessage").value = "";
}

// Loading States
function setLoading(isLoading, mode = "draft") {
  const sendBtn = document.getElementById("sendBtn");
  const sendBtnBuilder = document.getElementById("sendBtnBuilder");
  const btnText = document.getElementById("btnText");
  const btnLoader = document.getElementById("btnLoader");
  const approveBtn = document.getElementById("approveBtn");
  const reviseBtn = document.getElementById("reviseBtn");

  if (sendBtn) sendBtn.disabled = isLoading;
  if (sendBtnBuilder) sendBtnBuilder.disabled = isLoading;
  if (approveBtn) approveBtn.disabled = isLoading;
  if (reviseBtn) reviseBtn.disabled = isLoading;

  if (isLoading && mode === "draft") {
    btnText?.classList.add("hidden");
    btnLoader?.classList.remove("hidden");
  } else {
    btnText?.classList.remove("hidden");
    btnLoader?.classList.add("hidden");
  }
}

function showError(message) {
  const errorBox = document.getElementById("errorBox");
  const errorMessage = document.getElementById("errorMessage");
  if (!errorBox || !errorMessage) return;

  errorMessage.textContent = message;
  errorBox.classList.remove("hidden");
  errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
  const errorBox = document.getElementById("errorBox");
  if (errorBox) errorBox.classList.add("hidden");
}

// Workflow Visualizer
function showWorkflow(data) {
  const section = document.getElementById("workflowSection");
  const reasoning = document.getElementById("supervisorReasoning");
  const chips = document.getElementById("agentChips");
  const guardrailBadge = document.getElementById("guardrailBadge");

  if (!section) return;

  if (reasoning) {
    reasoning.textContent = data.supervisor_reasoning || "Supervisor analyzed trip constraints, validated feasibility, and orchestrated specialist execution.";
  }

  if (chips) {
    chips.innerHTML = "";
    (data.selected_agents || []).forEach((agentKey) => {
      const meta = AGENT_META[agentKey] || { name: agentKey, icon: "fa-robot", desc: "Specialist" };
      const chip = document.createElement("div");
      chip.className = "active-agent-badge";
      chip.innerHTML = `
        <i class="fa-solid ${meta.icon}"></i>
        <span>${meta.name}</span>
      `;
      chips.appendChild(chip);
    });
  }

  if (guardrailBadge) {
    if (data.guardrail_allowed === false) {
      guardrailBadge.innerHTML = `<i class="fa-solid fa-shield-xmark"></i> Guardrail Blocked`;
      guardrailBadge.className = "guardrail-chip blocked";
    } else {
      guardrailBadge.innerHTML = `<i class="fa-solid fa-shield-check"></i> Safety Guardrail Passed`;
      guardrailBadge.className = "guardrail-chip passed";
    }
  }

  section.classList.remove("hidden");
}

// Helper to look up coordinates for any place name
function resolveCoordinates(placeName) {
  if (!placeName) return null;
  const clean = placeName.toLowerCase().trim();

  // Exact match
  if (KNOWN_COORDINATES[clean]) return KNOWN_COORDINATES[clean];

  // Substring match
  for (const [key, coords] of Object.entries(KNOWN_COORDINATES)) {
    if (clean.includes(key) || (key.length >= 4 && clean.length >= 4 && key.includes(clean))) {
      return coords;
    }
  }
  return null;
}

/**
 * Dynamically extract stops and landmarks from generated itinerary markdown
 */
function extractStopsFromMarkdown(text, origin = "Hyderabad") {
  if (!text || typeof text !== "string") return [];
  const stops = [];
  const seenDays = new Set();

  // Regex matching "### 🔹 Day 1: Srisailam — Sacred Mallikarjuna" or "**Day 1**: Srisailam"
  const dayRegex = /(?:###\s*🔹?\s*Day\s*(\d+)|\*\*Day\s*(\d+)\*\*)[:\s—\-]+([^\n—\-–|]+)/gi;
  let match;
  while ((match = dayRegex.exec(text)) !== null) {
    const dayNum = parseInt(match[1] || match[2], 10);
    const rawName = (match[3] || "").trim().replace(/[*_#]/g, "");
    const cleanName = rawName.replace(/\(.*?\)/g, "").trim() || rawName;

    if (!seenDays.has(dayNum) && cleanName) {
      seenDays.add(dayNum);
      const coords = resolveCoordinates(cleanName);
      stops.push({
        day: dayNum,
        name: rawName,
        lat: coords ? coords[0] : 0,
        lng: coords ? coords[1] : 0,
        description: `Day ${dayNum} destination`
      });
    }
  }

  // If stops found and origin known, prepend origin as Day 0
  if (stops.length > 0 && origin && !stops.some(s => s.day === 0)) {
    const origCoords = resolveCoordinates(origin);
    stops.unshift({
      day: 0,
      name: origin,
      lat: origCoords ? origCoords[0] : 17.3850,
      lng: origCoords ? origCoords[1] : 78.4867,
      description: "Departure Hub"
    });
  }

  return stops;
}

/**
 * Interactive Leaflet Route Map Renderer with Connected Dots
 */
function renderRouteMap(routeStops, constraints = {}) {
  if (typeof L === "undefined") {
    console.warn("Leaflet library not loaded yet.");
    return;
  }

  const container = document.getElementById("routeMap");
  if (!container) return;

  // Prepare stops list
  let stops = [];
  if (Array.isArray(routeStops) && routeStops.length > 0) {
    stops = routeStops.map(s => ({ ...s }));
  }

  // If no stops from JSON, dynamically extract from active generated itinerary text
  if (stops.length < 2 && latestAnswerMarkdown) {
    stops = extractStopsFromMarkdown(latestAnswerMarkdown, constraints?.origin || "Hyderabad");
  }

  // Assign coordinates to stops
  const validPoints = [];
  stops.forEach((stop, idx) => {
    let coords = null;
    if (stop.lat && stop.lng && stop.lat !== 0 && stop.lng !== 0) {
      coords = [stop.lat, stop.lng];
    } else {
      coords = resolveCoordinates(stop.name);
    }

    if (coords) {
      stop.lat = coords[0];
      stop.lng = coords[1];
      validPoints.push(stop);
    }
  });

  if (validPoints.length === 0) {
    // Dynamic fallback to origin & destination
    const origName = constraints?.origin || "Hyderabad";
    const destName = constraints?.destination || "Destination";
    const origCoords = resolveCoordinates(origName) || [17.3850, 78.4867];
    const destCoords = resolveCoordinates(destName) || [16.0743, 78.8686];

    validPoints.push(
      { day: 0, name: origName, lat: origCoords[0], lng: origCoords[1], description: "Departure Point" },
      { day: 1, name: destName, lat: destCoords[0], lng: destCoords[1], description: "Main Circuit" }
    );
  }

  // Update stop count badge
  const countBadge = document.getElementById("routeStopsCount");
  if (countBadge) {
    countBadge.textContent = `${validPoints.length} Connected Stops`;
  }

  // Initialize or re-use Leaflet map
  if (activeInlineMap) {
    activeInlineMap.remove();
    activeInlineMap = null;
  }

  try {
    activeInlineMap = L.map("routeMap", {
      zoomControl: true,
      scrollWheelZoom: false
    });

    // Clean OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(activeInlineMap);

    const latlngs = [];

    // Add custom circle marker pins with numbers
    validPoints.forEach((point, i) => {
      const latlng = [point.lat, point.lng];
      latlngs.push(latlng);

      const isStart = i === 0;
      const isEnd = i === validPoints.length - 1 && validPoints.length > 2;
      const markerClass = isStart ? "map-route-marker origin" : (isEnd ? "map-route-marker destination" : "map-route-marker");
      const labelText = isStart ? "📍" : `${point.day !== undefined ? point.day : i}`;

      const customIcon = L.divIcon({
        className: "custom-div-marker",
        html: `<div class="${markerClass}">${labelText}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker(latlng, { icon: customIcon }).addTo(activeInlineMap);
      marker.bindPopup(`
        <div style="font-family: Plus Jakarta Sans, sans-serif; padding: 4px;">
          <strong style="color:#0284c7; font-size: 1rem;">Day ${point.day !== undefined ? point.day : (i + 1)}: ${point.name}</strong>
          <p style="margin: 4px 0 0; font-size: 0.88rem; color: #334155;">${point.description || 'Key itinerary stop'}</p>
        </div>
      `);
    });

    // Draw connected route polyline with animated dashed line style
    if (latlngs.length > 1) {
      const polyline = L.polyline(latlngs, {
        color: "#0284c7",
        weight: 4,
        opacity: 0.85,
        dashArray: "8, 8"
      }).addTo(activeInlineMap);

      activeInlineMap.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    } else {
      activeInlineMap.setView(latlngs[0], 10);
    }

    setTimeout(() => {
      activeInlineMap.invalidateSize();
    }, 200);

    // Build the connected timeline sequence below the map
    renderRouteTimeline("routeTimeline", validPoints);

  } catch (err) {
    console.error("Error initializing Leaflet map:", err);
  }
}

// Haversine road distance calculation helper
function calculateDistanceKm(c1, c2) {
  if (!c1 || !c2 || !c1[0] || !c2[0]) return null;
  const R = 6371; // Earth radius in km
  const dLat = (c2[0] - c1[0]) * Math.PI / 180;
  const dLon = (c2[1] - c1[1]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(c1[0] * Math.PI / 180) * Math.cos(c2[0] * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(15, Math.round(R * c * 1.25));
}

// Render connected stop timeline below map with exact calculated road distances
function renderRouteTimeline(elementId, stops) {
  const container = document.getElementById(elementId);
  if (!container) return;

  container.innerHTML = "";

  const transitIcons = [
    { icon: "fa-car", label: "Cab / Taxi" },
    { icon: "fa-bus", label: "AC Bus" },
    { icon: "fa-train", label: "Express Rail" }
  ];

  stops.forEach((stop, i) => {
    // Step bubble
    const node = document.createElement("div");
    node.className = "route-step-node";

    const bubble = document.createElement("div");
    bubble.className = "step-node-bubble";
    const dayLabel = stop.day !== undefined ? (stop.day === 0 ? "Start" : `Day ${stop.day}`) : `Day ${i + 1}`;
    bubble.innerHTML = `
      <i class="fa-solid fa-location-dot"></i>
      <span><strong>${dayLabel}:</strong> ${stop.name}</span>
    `;
    node.appendChild(bubble);

    // Connector arrow if not last, annotated with real distance in km
    if (i < stops.length - 1) {
      const next = stops[i + 1];
      const dist = (stop.lat && next.lat)
        ? calculateDistanceKm([stop.lat, stop.lng], [next.lat, next.lng])
        : null;

      const transit = transitIcons[i % transitIcons.length];
      const distText = dist ? `${dist} km (~${(dist / 48).toFixed(1)}h)` : transit.label;

      const arrow = document.createElement("div");
      arrow.className = "step-transit-arrow";
      arrow.innerHTML = `
        <i class="fa-solid ${transit.icon}"></i>
        <span style="font-weight: 700; color: #0284c7;">${distText}</span>
      `;
      node.appendChild(arrow);
    }

    container.appendChild(node);
  });
}

// Result Renderer with Tabs
function showResult(data, isDraft = false) {
  currentDataPayload = data;
  const answer = (isDraft ? data.itinerary : data.answer) || data.answer || "";
  latestAnswerMarkdown = answer;

  const resultSection = document.getElementById("resultSection");
  const resultBox = document.getElementById("resultBox");
  const flightsBox = document.getElementById("flightsBox");
  const hotelsBox = document.getElementById("hotelsBox");
  const weatherBox = document.getElementById("weatherBox");
  const budgetBox = document.getElementById("budgetBox");
  const threadInfo = document.getElementById("threadInfo");
  const resultTitle = document.getElementById("resultTitle");

  if (!resultSection) return;

  // Render Full Plan
  renderMarkdown(resultBox, answer);

  // Render Specialist Tabs
  renderMarkdown(flightsBox, data.flight_results || "### Transport Guidance\n*Multi-modal transport guidance integrated into the master plan.*");
  renderMarkdown(hotelsBox, data.hotel_results || "### Hotel Suggestions\n*Accommodation options are curated in the master blueprint.*");
  renderMarkdown(weatherBox, data.weather_results || "### Climate Forecast\n*Weather analysis and packing tips are integrated in the master blueprint.*");
  renderMarkdown(budgetBox, data.budget_results || "### Budget Assessment\n*Cost breakdown and feasibility details are integrated in the master blueprint.*");

  if (threadInfo) {
    threadInfo.textContent = `Session: ${data.thread_id}`;
  }

  if (resultTitle) {
    resultTitle.innerHTML = isDraft
      ? `<i class="fa-regular fa-clock" style="color: #0284c7;"></i> Draft Itinerary Awaiting Approval`
      : `<i class="fa-solid fa-crown" style="color: #f59e0b;"></i> Curated Bespoke Travel Blueprint`;
  }

  resultSection.classList.remove("hidden");
  switchResultTab("full");

  // Render Leaflet Route Map
  renderRouteMap(data.route_stops, data.trip_constraints);

  resultSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function switchResultTab(tabName) {
  document.querySelectorAll(".res-tab-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  document.querySelectorAll(".plan-tab-pane").forEach((pane) => {
    pane.classList.remove("active");
    pane.classList.add("hidden");
  });

  const tabIndexMap = {
    full: "tabContentFull",
    map: "tabContentMap",
    flights: "tabContentFlights",
    hotels: "tabContentHotels",
    weather: "tabContentWeather",
    budget: "tabContentBudget"
  };

  const targetPaneId = tabIndexMap[tabName] || "tabContentFull";
  const targetPane = document.getElementById(targetPaneId);
  if (targetPane) {
    targetPane.classList.remove("hidden");
    targetPane.classList.add("active");
  }

  // Leaflet map needs invalidateSize when switching into its tab
  if (tabName === "map" || tabName === "full") {
    setTimeout(() => {
      if (activeInlineMap) activeInlineMap.invalidateSize();
    }, 150);
  }
}

function showApproval(data) {
  waitingForApproval = true;
  const section = document.getElementById("approvalSection");
  const approvalRequest = document.getElementById("approvalRequest");

  if (!section) return;

  if (approvalRequest) {
    approvalRequest.textContent =
      data.approval_request ||
      "Please review this draft itinerary. You have complete control: approve to finalize the master travel blueprint, or provide specific adjustments below.";
  }
  section.classList.remove("hidden");
}

function hideApproval() {
  waitingForApproval = false;
  const section = document.getElementById("approvalSection");
  if (section) section.classList.add("hidden");
  const feedbackInput = document.getElementById("approvalFeedback");
  if (feedbackInput) feedbackInput.value = "";
}

function resetPlanner() {
  currentThreadId = null;
  localStorage.removeItem("travel_thread_id");
  hideApproval();

  const userInput = document.getElementById("userInput");
  if (userInput) userInput.value = "";

  document.getElementById("resultSection")?.classList.add("hidden");
  document.getElementById("workflowSection")?.classList.add("hidden");
  hideError();

  document.getElementById("plannerSection")?.scrollIntoView({ behavior: "smooth" });
}

// Send Message (POST /api/travel) with Mood & Preferences
async function sendMessage() {
  hideError();

  if (waitingForApproval) {
    showError("Please approve or revise the current draft before starting a new journey.");
    return;
  }

  const input = document.getElementById("userInput");
  let message = input ? input.value.trim() : "";

  if (!message) {
    showError("Please describe your travel vision or select a destination inspiration card.");
    if (input) input.focus();
    return;
  }

  // Append mood context if not already mentioned
  const moodInfo = MOOD_DATA[currentPreferences.mood];
  if (moodInfo && !message.toLowerCase().includes(currentPreferences.mood)) {
    message += moodInfo.promptSuffix;
  }

  setLoading(true, "draft");

  try {
    const response = await fetch("/api/travel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: message,
        thread_id: currentThreadId,
        preferences: currentPreferences
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to orchestrate travel agents.");
    }

    currentThreadId = data.thread_id;
    localStorage.setItem("travel_thread_id", currentThreadId);

    showWorkflow(data);

    if (data.requires_approval) {
      showResult(data, true);
      showApproval(data);
    } else {
      hideApproval();
      showResult(data, false);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, "draft");
  }
}

// Submit Human Approval (POST /api/travel/approve)
async function submitApproval(approved) {
  hideError();

  if (!currentThreadId || !waitingForApproval) {
    showError("There is no active draft awaiting approval.");
    return;
  }

  const feedbackInput = document.getElementById("approvalFeedback");
  const feedback = feedbackInput ? feedbackInput.value.trim() : "";

  if (!approved && !feedback) {
    showError("Please enter your revision instructions before requesting changes.");
    if (feedbackInput) feedbackInput.focus();
    return;
  }

  setLoading(true, "approval");

  try {
    const response = await fetch("/api/travel/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        thread_id: currentThreadId,
        approved: approved,
        feedback: feedback
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Could not resume the LangGraph approval workflow.");
    }

    showWorkflow(data);
    hideApproval();
    showResult(data, false);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, "approval");
  }
}

// Clipboard Copy
function copyResult() {
  const resultBox = document.getElementById("resultBox");
  const text = resultBox ? resultBox.innerText : "";

  if (!text) return;

  navigator.clipboard.writeText(latestAnswerMarkdown || text)
    .then(() => {
      const copyBtn = document.getElementById("copyBtn");
      if (copyBtn) {
        const oldHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
        setTimeout(() => {
          copyBtn.innerHTML = oldHtml;
        }, 1800);
      }
    })
    .catch(() => {
      showError("Could not copy itinerary to clipboard.");
    });
}

// PDF Export with Clean Visible Modal Container (Zero Blank Pages, Clean Route & Distance Summary)
function downloadPDF() {
  const answer = latestAnswerMarkdown || (document.getElementById("resultBox") ? document.getElementById("resultBox").innerText : "");

  if (!answer) {
    showError("No travel plan available to download.");
    return;
  }

  const downloadBtn = document.getElementById("pdfBtn");
  const oldHtml = downloadBtn ? downloadBtn.innerHTML : "";
  if (downloadBtn) {
    downloadBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Exporting PDF...`;
    downloadBtn.disabled = true;
  }

  // Remove existing overlay if any
  const oldOverlay = document.getElementById("pdfExportModalOverlay");
  if (oldOverlay) oldOverlay.remove();

  // Create clean modal overlay
  const modalOverlay = document.createElement("div");
  modalOverlay.id = "pdfExportModalOverlay";
  modalOverlay.style.position = "fixed";
  modalOverlay.style.top = "0";
  modalOverlay.style.left = "0";
  modalOverlay.style.width = "100%";
  modalOverlay.style.height = "100%";
  modalOverlay.style.backgroundColor = "rgba(15, 23, 42, 0.75)";
  modalOverlay.style.zIndex = "999999";
  modalOverlay.style.display = "flex";
  modalOverlay.style.flexDirection = "column";
  modalOverlay.style.alignItems = "center";
  modalOverlay.style.overflowY = "auto";
  modalOverlay.style.padding = "24px 12px";

  // Clean status toast
  const toast = document.createElement("div");
  toast.style.background = "#0284c7";
  toast.style.color = "#ffffff";
  toast.style.padding = "10px 24px";
  toast.style.borderRadius = "30px";
  toast.style.fontWeight = "700";
  toast.style.fontSize = "13.5px";
  toast.style.marginBottom = "14px";
  toast.style.boxShadow = "0 4px 14px rgba(0,0,0,0.3)";
  toast.innerHTML = `<i class="fa-solid fa-file-pdf"></i> Synthesizing Master PDF Blueprint (Page 1 Starting Immediately)...`;
  modalOverlay.appendChild(toast);

  // Create clean printable element
  const printContainer = document.createElement("div");
  printContainer.id = "cleanPrintExportContainer";
  printContainer.style.width = "760px";
  printContainer.style.padding = "28px 32px";
  printContainer.style.background = "#ffffff";
  printContainer.style.color = "#0f172a";
  printContainer.style.fontFamily = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  printContainer.style.lineHeight = "1.6";
  printContainer.style.fontSize = "12.5px";
  printContainer.style.borderRadius = "8px";
  printContainer.style.boxShadow = "0 10px 40px rgba(0,0,0,0.35)";

  // Build Route Summary Table HTML from active stops
  let stops = [];
  if (currentDataPayload && Array.isArray(currentDataPayload.route_stops) && currentDataPayload.route_stops.length > 0) {
    stops = currentDataPayload.route_stops;
  } else {
    stops = extractStopsFromMarkdown(answer, currentDataPayload?.trip_constraints?.origin || "Hyderabad");
  }

  let stopsTableHtml = "";
  if (stops.length > 0) {
    stopsTableHtml = `
      <div style="margin: 14px 0 20px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; page-break-inside: avoid;">
        <div style="background: #f1f5f9; padding: 10px 16px; border-bottom: 1px solid #cbd5e1; font-weight: 700; color: #0f172a; font-size: 13.5px;">
          🗺️ Connected Pilgrimage Circuit & Day-by-Day Route Overview
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; text-align: left;">
          <thead>
            <tr style="background: #f8fafc; color: #475569; border-bottom: 1px solid #cbd5e1;">
              <th style="padding: 8px 12px; width: 65px; font-weight: 700;">Day</th>
              <th style="padding: 8px 12px; width: 220px; font-weight: 700;">Location / Sacred Shrine</th>
              <th style="padding: 8px 12px; font-weight: 700;">Key Schedule & Travel Highlights</th>
            </tr>
          </thead>
          <tbody>
            ${stops.map((s, idx) => `
              <tr style="border-bottom: 1px solid #f1f5f9; ${idx % 2 === 1 ? 'background: #f8fafc;' : ''}">
                <td style="padding: 7px 12px; font-weight: 700; color: #0284c7;">Day ${s.day !== undefined ? s.day : idx}</td>
                <td style="padding: 7px 12px; font-weight: 600; color: #0f172a;">${s.name}</td>
                <td style="padding: 7px 12px; color: #334155;">${s.description || 'Primary planned milestone'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Parse markdown into clean HTML
  let parsedContent = "";
  if (typeof marked !== "undefined" && typeof marked.parse === "function") {
    parsedContent = marked.parse(toMarkdownString(answer));
  } else {
    parsedContent = `<pre style="white-space: pre-wrap;">${answer}</pre>`;
  }

  const origin = currentDataPayload?.trip_constraints?.origin || "Hyderabad";
  const dest = currentDataPayload?.trip_constraints?.destination || "Andhra Pradesh";

  printContainer.innerHTML = `
    <div style="border-bottom: 2.5px solid #0284c7; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end;">
      <div>
        <div style="font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">WANDERLUXE <span style="color: #0284c7;">AI</span></div>
        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Autonomous Multi-Agent Travel Intelligence Platform</div>
      </div>
      <div style="text-align: right; font-size: 11px; color: #64748b;">
        <div><strong>Circuit:</strong> ${origin} ➔ ${dest}</div>
        <div><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
        <div><strong>Session:</strong> ${currentDataPayload?.thread_id || 'WL-ACTIVE'}</div>
      </div>
    </div>
    ${stopsTableHtml}
    <div class="pdf-markdown-body" style="font-size: 11.5px; color: #1e293b; line-height: 1.6;">
      ${parsedContent}
    </div>
    <div style="margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 9.5px; color: #94a3b8; text-align: center;">
      Curated by WanderLuxe AI Multi-Agent Swarm • LangGraph + MCP + Groq + OpenWeather FastMCP
    </div>
  `;

  modalOverlay.appendChild(printContainer);
  document.body.appendChild(modalOverlay);

  if (typeof html2pdf !== "undefined") {
    const options = {
      margin: [10, 10, 10, 10], // in millimeters
      filename: `WanderLuxe-Itinerary-${new Date().toISOString().slice(0, 10)}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: 800
      },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] }
    };

    html2pdf()
      .set(options)
      .from(printContainer)
      .save()
      .then(() => {
        modalOverlay.remove();
        if (downloadBtn) {
          downloadBtn.innerHTML = oldHtml;
          downloadBtn.disabled = false;
        }
      })
      .catch((err) => {
        console.error("PDF export error:", err);
        modalOverlay.remove();
        if (downloadBtn) {
          downloadBtn.innerHTML = oldHtml;
          downloadBtn.disabled = false;
        }
        showError("Could not generate PDF. Please try copying the text.");
      });
  } else {
    window.print();
    modalOverlay.remove();
    if (downloadBtn) {
      downloadBtn.innerHTML = oldHtml;
      downloadBtn.disabled = false;
    }
  }
}

// Keyboard shortcuts
document.addEventListener("keydown", function(event) {
  if (event.ctrlKey && event.key === "Enter") {
    sendMessage();
  }
});
