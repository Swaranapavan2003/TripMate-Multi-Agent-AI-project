/**
 * WanderLuxe AI — Autonomous Multi-Agent Travel Intelligence Platform
 * Client Application Engine
 */

let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";
let waitingForApproval = false;
let currentDataPayload = null;
let currentAgentSlideIndex = 0;

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
    name: "SkyScout Flight Agent",
    icon: "fa-plane-departure",
    desc: "AviationStack & Airline Routing Engine"
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
    desc: "Harmonized Day-by-Day Master Plan"
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
  const origin = document.getElementById("builderOrigin")?.value.trim() || "my departure city";
  const dest = document.getElementById("builderDest")?.value.trim() || "my dream destination";
  const duration = document.getElementById("builderDuration")?.value || "7 days";
  const budget = document.getElementById("builderBudget")?.value.trim() || "a comfortable budget";

  const styles = [];
  document.querySelectorAll("input[name='style']:checked").forEach((chk) => {
    styles.push(chk.value);
  });
  const styleStr = styles.length > 0 ? ` Focusing on ${styles.join(", ")}.` : "";

  const assembled = `Plan a complete ${duration} trip to ${dest} from ${origin} under ${budget}.${styleStr} Include flight routes, hotel options, daily sightseeing, and weather-aware advice.`;
  
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
  renderMarkdown(flightsBox, data.flight_results || "### Flight Information\n*Flight guidance has been generated and integrated into the master blueprint.*");
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
}

function showApproval(data) {
  waitingForApproval = true;
  const section = document.getElementById("approvalSection");
  const approvalRequest = document.getElementById("approvalRequest");

  if (!section) return;

  if (approvalRequest) {
    approvalRequest.textContent =
      data.approval_request ||
      "Please review this draft itinerary. You have complete control: approve to synthesize the finalized blueprint, or request specific modifications.";
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

// Send Message (POST /api/travel)
async function sendMessage() {
  hideError();

  if (waitingForApproval) {
    showError("Please approve or revise the current draft before starting a new journey.");
    return;
  }

  const input = document.getElementById("userInput");
  const message = input ? input.value.trim() : "";

  if (!message) {
    showError("Please describe your travel vision or select a destination inspiration card.");
    if (input) input.focus();
    return;
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
        thread_id: currentThreadId
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

// PDF Export
function downloadPDF() {
  const pdfContent = document.getElementById("pdfContent");

  if (!latestAnswerMarkdown || !pdfContent) {
    showError("No travel plan available to download.");
    return;
  }

  const downloadBtn = document.getElementById("pdfBtn");
  const oldHtml = downloadBtn ? downloadBtn.innerHTML : "";
  if (downloadBtn) {
    downloadBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...`;
    downloadBtn.disabled = true;
  }

  if (typeof html2pdf !== "undefined") {
    const options = {
      margin: [0.5, 0.5, 0.5, 0.5],
      filename: `WanderLuxe-Itinerary-${new Date().toISOString().slice(0, 10)}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] }
    };

    html2pdf()
      .set(options)
      .from(pdfContent)
      .save()
      .then(() => {
        if (downloadBtn) {
          downloadBtn.innerHTML = oldHtml;
          downloadBtn.disabled = false;
        }
      })
      .catch(() => {
        if (downloadBtn) {
          downloadBtn.innerHTML = oldHtml;
          downloadBtn.disabled = false;
        }
        showError("Could not generate PDF.");
      });
  } else {
    window.print();
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
