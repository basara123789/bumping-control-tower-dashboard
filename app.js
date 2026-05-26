const API_ENDPOINTS = {
  kpis: "/api/kpi/overview",
  machines: "/api/bumping/machines",
  alarms: "/api/alarm/history",
  facility: "/api/facility-energy/timeseries",
  environment: "/api/environment/status",
  workforce: "/api/workforce/status",
  analytics: "/api/ai-analytics/scores"
};

const SIMULATION = {
  DEFAULT_SPEED: 1200,
  EVENT_EVERY_TICKS: 4,
  ALARM_BURST_TICKS: 8,
  TOOL_DOWN_TICKS: 10,
  STATUS_WAVE_SPEED: 0.18,
  ALARM_WAVE_SPEED: 0.31,
  UPH_WAVE_SPEED: 0.25,
  YIELD_WAVE_SPEED: 0.16,
  UTIL_WAVE_SPEED: 0.2,
  RISK_WAVE_SPEED: 0.21,
  YIELD_MIN: 88,
  YIELD_MAX: 99.6,
  STATUS_PENALTY: {
    Running: 1,
    Idle: 0.72,
    Warning: 0.84,
    Down: 0.42
  }
};

const palette = {
  blue: "#285fd4",
  cyan: "#00abc2",
  pink: "#d930a1",
  violet: "#6f42c1",
  orange: "#df7b22",
  yellow: "#d6a928",
  green: "#0b9f6a",
  red: "#d64545",
  grid: "rgba(79, 69, 42, 0.16)",
  ink: "#1f2937"
};

const stateColors = {
  Running: palette.green,
  Idle: palette.blue,
  Warning: palette.yellow,
  Down: palette.red
};

const machineConfig = [
  { id: "COATER 01", type: "DRY", x: 92, y: 164, color: "pink", baseUph: 820, baseYield: 98.4, util: 88, statusSeed: 2 },
  { id: "CCATE 01", type: "WET1", x: 298, y: 82, color: "cyan", baseUph: 760, baseYield: 97.8, util: 84, statusSeed: 7 },
  { id: "CHEF 02", type: "WET2", x: 526, y: 102, color: "pink", baseUph: 715, baseYield: 97.2, util: 81, statusSeed: 11 },
  { id: "DEV 03", type: "DRY", x: 396, y: 170, color: "blue", baseUph: 845, baseYield: 98.7, util: 91, statusSeed: 4 },
  { id: "ETCH 08", type: "WET2", x: 636, y: 196, color: "cyan", baseUph: 700, baseYield: 96.8, util: 79, statusSeed: 15 },
  { id: "DRY 12", type: "DRY", x: 204, y: 34, color: "blue", baseUph: 835, baseYield: 98.9, util: 89, statusSeed: 19 }
];

const uiState = {
  selectedMachine: 0,
  filter: "ALL",
  shift: "Day"
};

const simulationState = {
  tick: 0,
  playing: true,
  speed: SIMULATION.DEFAULT_SPEED,
  alarmBoostUntil: 0,
  snapshots: [],
  filteredSnapshots: [],
  events: []
};

const runtimeState = {
  timer: null,
  els: {},
  charts: {},
  resizeHandler: null,
  ready: false
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wave = (base, amp, speed, phase = 0) => base + Math.sin(simulationState.tick * speed + phase) * amp;
const average = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const visibleMachineConfigs = () => machineConfig.filter(machine => uiState.filter === "ALL" || machine.type === uiState.filter);

function calculateMachineSnapshot(machine, index) {
  const phase = machine.statusSeed + index * 0.7;
  const boosted = simulationState.tick < simulationState.alarmBoostUntil;
  const statusCycle = Math.sin(simulationState.tick * SIMULATION.STATUS_WAVE_SPEED + phase);
  let status = "Running";
  if (statusCycle > 0.91) status = "Warning";
  if (statusCycle < -0.94) status = "Idle";
  if (machine.forceDownUntil && simulationState.tick < machine.forceDownUntil) status = "Down";

  const statusPenalty = SIMULATION.STATUS_PENALTY[status];
  const alarmMultiplier = boosted ? 2.2 : 1;
  const baseAlarm = status === "Down" ? 6 : status === "Warning" ? 3 : status === "Idle" ? 1 : 0;
  const alarms = Math.max(0, Math.round(baseAlarm * alarmMultiplier + Math.abs(Math.sin(simulationState.tick * SIMULATION.ALARM_WAVE_SPEED + phase)) * 2));

  return {
    ...machine,
    index,
    status,
    uph: Math.round(wave(machine.baseUph, 28, SIMULATION.UPH_WAVE_SPEED, phase) * statusPenalty),
    yield: clamp(
      wave(machine.baseYield, 0.55, SIMULATION.YIELD_WAVE_SPEED, phase) - (status === "Warning" ? 0.7 : 0) - (status === "Down" ? 3.2 : 0),
      SIMULATION.YIELD_MIN,
      SIMULATION.YIELD_MAX
    ),
    util: clamp(wave(machine.util, 4.2, SIMULATION.UTIL_WAVE_SPEED, phase) * statusPenalty, 0, 99),
    alarms,
    risk: clamp(alarms * 12 + (100 - machine.baseYield) * 8 + Math.abs(Math.sin(simulationState.tick * SIMULATION.RISK_WAVE_SPEED + phase)) * 20, 4, 98)
  };
}

function refreshMachineSnapshots() {
  simulationState.snapshots = machineConfig.map(calculateMachineSnapshot);
}

function refreshDerivedState() {
  simulationState.filteredSnapshots = simulationState.snapshots.filter(machine => uiState.filter === "ALL" || machine.type === uiState.filter);
}

function advanceSimulation() {
  simulationState.tick += 1;
  refreshMachineSnapshots();
  refreshDerivedState();

  if (simulationState.tick % SIMULATION.EVENT_EVERY_TICKS === 0) {
    const risky = [...simulationState.snapshots].sort((a, b) => b.risk - a.risk)[0];
    addEvent(risky.status === "Running" ? "ok" : risky.status === "Warning" ? "warn" : risky.status === "Down" ? "hot" : "ack", risky);
  }
}

function buildDashboardContext() {
  const scoped = simulationState.filteredSnapshots;
  const selected = simulationState.snapshots[uiState.selectedMachine] || scoped[0] || simulationState.snapshots[0];
  const alarmTotal = scoped.reduce((sum, machine) => sum + machine.alarms, 0);
  const health = 100 - average(scoped.map(machine => machine.risk)) * 0.42;
  return {
    alarmTotal,
    health,
    scoped,
    selected
  };
}

function buildEquipment(context) {
  return {
    ...context.selected,
    runTime: `${10 + (simulationState.tick + uiState.selectedMachine) % 7}h ${String(24 + (simulationState.tick * 3) % 36).padStart(2, "0")}m`,
    lastPm: `${3 + (uiState.selectedMachine % 5)} Days Ago`
  };
}

function buildKpis(context) {
  const { alarmTotal, health, scoped } = context;
  return [
    { label: "UPH", value: Math.round(average(scoped.map(machine => machine.uph))), unit: "", trend: "+3.2%" },
    { label: "OEE", value: clamp(average(scoped.map(machine => machine.util)) + 5, 0, 99).toFixed(1), unit: "%", trend: "+1.1%" },
    { label: "Yield", value: average(scoped.map(machine => machine.yield)).toFixed(1), unit: "%", trend: "+0.4%" },
    { label: "Utilization", value: Math.round(average(scoped.map(machine => machine.util))), unit: "%", trend: uiState.shift },
    { label: "Alarms", value: alarmTotal, unit: "", trend: alarmTotal > 12 ? "High" : "Normal" },
    { label: "AI Health", value: Math.round(health), unit: "%", trend: health > 78 ? "Stable" : "Watch" }
  ];
}

function buildTrends(context) {
  const { selected } = context;
  return Array.from({ length: 12 }, (_, i) => ({
    uph: selected.uph * (0.92 + Math.sin(simulationState.tick * SIMULATION.STATUS_WAVE_SPEED + i * 0.44) * 0.06),
    yield: selected.yield + Math.sin(simulationState.tick * 0.15 + i * 0.5) * 0.7,
    alarm: 6 + selected.alarms * 5 + Math.abs(Math.sin(simulationState.tick * 0.3 + i * 0.8)) * 30
  }));
}

function buildEnergy(context) {
  const scopedCount = context.scoped.length;
  return {
    energy: Array.from({ length: 12 }, (_, i) => ({
      bar: 28 + Math.abs(Math.sin(simulationState.tick * 0.22 + i * 0.65)) * 46 + scopedCount * 2,
      line: 58 - i * 1.8 + Math.sin(simulationState.tick * 0.16 + i) * 7
    })),
    utility: Array.from({ length: 18 }, (_, i) => 24 + Math.sin(simulationState.tick * 0.2 + i * 0.45) * 8 + i * 1.25 + scopedCount)
  };
}

function buildEnvironment(context) {
  const { scoped, selected } = context;
  return {
    temp: wave(23.5, 0.7, 0.2).toFixed(1),
    humidity: Math.round(wave(45, 4, 0.14)),
    pressure: Math.round(wave(-10, 3, 0.26)),
    gauge: clamp(selected.util, 0, 100),
    bars: Array.from({ length: 16 }, (_, i) => 18 + Math.abs(Math.sin(simulationState.tick * SIMULATION.RISK_WAVE_SPEED + i * 0.7)) * 46),
    riskRows: scoped.map((machine, row) => Array.from({ length: 10 }, (_, col) => clamp(machine.risk + Math.sin(simulationState.tick * 0.19 + row + col * 0.6) * 18, 0, 100))),
    spark: scoped.map(machine => machine.risk)
  };
}

function buildWorkforce() {
  return [
    { label: "Online", value: Math.round(wave(uiState.shift === "Day" ? 45 : 31, 3, 0.12)), color: palette.cyan },
    { label: "No Badge", value: Math.round(wave(9, 2, 0.35)), color: palette.blue },
    { label: "Assist", value: Math.round(wave(3, 1, 0.28)), color: palette.violet },
    { label: "Support", value: Math.round(wave(uiState.shift === "Day" ? 12 : 7, 2, 0.18)), color: palette.orange }
  ];
}

function buildAlarmTable(context) {
  return context.scoped.slice(0, 5).map((machine, index) => [
    machine.status === "Down" ? "Tool Down" : machine.status === "Warning" ? "Parameter Drift" : machine.alarms > 2 ? "ACK Timeout" : "Monitor",
    machine.id,
    `${String(8 + index + (simulationState.tick % 8)).padStart(2, "0")}:${String((simulationState.tick * 7 + index * 9) % 60).padStart(2, "0")}`,
    machine.type,
    machine.status === "Running" ? "Normal" : machine.status,
    machine.status === "Down" ? "hot" : machine.status === "Warning" ? "warn" : machine.status === "Idle" ? "ack" : "ok"
  ]);
}

function buildAnalytics(context) {
  const { selected } = context;
  return [
    82 - selected.alarms * 3 + Math.sin(simulationState.tick * 0.2) * 4,
    72 + Math.cos(simulationState.tick * 0.16) * 8 - selected.risk * 0.1,
    selected.yield,
    88 - Math.max(0, selected.risk - 35) * 0.35,
    selected.status === "Down" ? 45 : selected.status === "Warning" ? 66 : 86
  ].map(value => clamp(value, 0, 100));
}

function generateMockDashboardData() {
  const context = buildDashboardContext();
  const energyData = buildEnergy(context);

  return {
    endpoints: API_ENDPOINTS,
    machines: simulationState.snapshots,
    scopedMachines: context.scoped,
    machine: buildEquipment(context),
    kpis: buildKpis(context),
    trends: buildTrends(context),
    energy: energyData.energy,
    utility: energyData.utility,
    environment: buildEnvironment(context),
    workforce: buildWorkforce(),
    table: buildAlarmTable(context),
    events: simulationState.events.slice(0, 5),
    analytics: buildAnalytics(context)
  };
}

function cacheElements() {
  const byId = id => document.getElementById(id);
  runtimeState.els = {
    alarmBars: byId("alarmBars"),
    alarmBurst: byId("alarmBurst"),
    alarmTable: byId("alarmTable"),
    alarmTrend: byId("alarmTrend"),
    analyticsButtons: [...document.querySelectorAll(".analytics-actions button")],
    clock: byId("clock"),
    cycleMachine: byId("cycleMachine"),
    energyMixed: byId("energyMixed"),
    environmentStatus: byId("environmentStatus"),
    eventList: byId("eventList"),
    factoryScene: byId("factoryScene"),
    gaugeChart: byId("gaugeChart"),
    humidValue: byId("humidValue"),
    kpiStrip: byId("kpiStrip"),
    lotType: byId("lotType"),
    machineName: byId("machineName"),
    machineState: byId("machineState"),
    machineStateDot: byId("machineStateDot"),
    machineTooltip: byId("machineTooltip"),
    miniCombo: byId("miniCombo"),
    peopleList: byId("peopleList"),
    pressureValue: byId("pressureValue"),
    radarChart: byId("radarChart"),
    runTime: byId("runTime"),
    shiftLabel: byId("shiftLabel"),
    shiftToggle: byId("shiftToggle"),
    simulateDown: byId("simulateDown"),
    sparkArea: byId("sparkArea"),
    speedRange: byId("speedRange"),
    tempValue: byId("tempValue"),
    togglePlay: byId("togglePlay"),
    toolKpi: byId("toolKpi"),
    typeFilters: byId("typeFilters"),
    utilityArea: byId("utilityArea")
  };
}

function setupFactory() {
  machineConfig.forEach((machine, index) => {
    const tool = document.createElement("div");
    tool.className = "tool";
    tool.dataset.index = index;
    tool.style.left = `${machine.x}px`;
    tool.style.top = `${machine.y}px`;
    tool.innerHTML = `
      <div class="roof"></div>
      <div class="body"></div>
      <div class="state-light"></div>
      <div class="label">${machine.type} ${machine.id}</div>
      <i class="beacon ${machine.color}" style="left:12px;top:72px"></i>
      <i class="beacon cyan" style="left:78px;top:82px;animation-delay:${index * 0.13}s"></i>
      <i class="beacon blue" style="left:42px;top:92px;animation-delay:${index * 0.21}s"></i>
    `;
    tool.addEventListener("click", () => {
      uiState.selectedMachine = index;
      renderDashboard();
    });
    tool.addEventListener("mousemove", event => showTooltip(event, index));
    tool.addEventListener("mouseleave", hideTooltip);
    runtimeState.els.factoryScene.appendChild(tool);
  });
  runtimeState.els.tools = [...document.querySelectorAll(".tool")];
}

function showTooltip(event, index) {
  const tooltip = runtimeState.els.machineTooltip;
  const sceneRect = runtimeState.els.factoryScene.getBoundingClientRect();
  const machine = simulationState.snapshots[index];
  const tooltipWidth = 190;
  const tooltipHeight = 112;
  const rawLeft = event.clientX - sceneRect.left + 12;
  const rawTop = event.clientY - sceneRect.top - 6;

  tooltip.innerHTML = `
    <strong>${machine.type} ${machine.id}</strong>
    Status: ${machine.status}<br>
    UPH: ${machine.uph}<br>
    Yield: ${machine.yield.toFixed(1)}%<br>
    Utilization: ${machine.util.toFixed(0)}%<br>
    Alarms: ${machine.alarms}
  `;
  tooltip.style.left = `${clamp(rawLeft, 8, sceneRect.width - tooltipWidth)}px`;
  tooltip.style.top = `${clamp(rawTop, 8, sceneRect.height - tooltipHeight)}px`;
  tooltip.style.display = "block";
}

function hideTooltip() {
  runtimeState.els.machineTooltip.style.display = "none";
}

function setupCharts() {
  [
    "alarmTrend",
    "alarmBars",
    "energyMixed",
    "utilityArea",
    "gaugeChart",
    "miniCombo",
    "environmentStatus",
    "sparkArea",
    "donutChart",
    "radarChart"
  ].forEach(id => {
    const canvas = document.getElementById(id);
    runtimeState.charts[id] = {
      canvas,
      ctx: canvas.getContext("2d"),
      w: 0,
      h: 0
    };
  });
  resizeAllCharts();
}

function resizeAllCharts() {
  Object.values(runtimeState.charts).forEach(chart => {
    const rect = chart.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    chart.canvas.width = Math.max(10, Math.floor(rect.width * dpr));
    chart.canvas.height = Math.max(10, Math.floor(rect.height * dpr));
    chart.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    chart.w = rect.width;
    chart.h = rect.height;
  });
}

function clearChart(chart) {
  chart.ctx.clearRect(0, 0, chart.w, chart.h);
  chart.ctx.fillStyle = "rgba(255,255,255,0.18)";
  chart.ctx.fillRect(0, 0, chart.w, chart.h);
}

function drawGrid(chart, lines = 4) {
  const { ctx, w, h } = chart;
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for (let i = 1; i <= lines; i++) {
    const y = (h / (lines + 1)) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawBars(chart, values, colors = [palette.orange, palette.blue, palette.violet, palette.cyan]) {
  const { ctx, w, h } = chart;
  clearChart(chart);
  drawGrid(chart);
  const max = Math.max(...values, 1);
  const gap = 5;
  const bw = (w - gap * (values.length + 1)) / values.length;
  values.forEach((v, i) => {
    const bh = (v / max) * (h - 16);
    const x = gap + i * (bw + gap);
    const y = h - bh - 6;
    const grad = ctx.createLinearGradient(0, y, 0, h);
    grad.addColorStop(0, colors[i % colors.length]);
    grad.addColorStop(1, "rgba(255,210,64,0.22)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, bw, bh);
  });
}

function drawLine(chart, values, color = palette.blue, fill = false) {
  const { ctx, w, h } = chart;
  clearChart(chart);
  drawGrid(chart);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values.map((v, i) => ({
    x: values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 14) + 7,
    y: h - 8 - ((v - min) / Math.max(1, max - min)) * (h - 18)
  }));
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  if (fill) {
    ctx.lineTo(w - 7, h - 7);
    ctx.lineTo(7, h - 7);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(255,176,31,0.14)");
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.66;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.stroke();
}

function drawMixed(chart, data) {
  const { ctx, w, h } = chart;
  clearChart(chart);
  drawGrid(chart);
  const bars = data.map(d => d.bar);
  const lines = data.map(d => d.line);
  const max = Math.max(...bars, ...lines);
  const gap = 4;
  const bw = (w - gap * (data.length + 1)) / data.length;
  bars.forEach((v, i) => {
    const bh = (v / max) * (h - 16);
    const x = gap + i * (bw + gap);
    ctx.fillStyle = i % 2 ? palette.cyan : palette.orange;
    ctx.fillRect(x, h - bh - 7, bw, bh);
  });
  const points = lines.map((v, i) => ({
    x: gap + i * (bw + gap) + bw / 2,
    y: h - 7 - (v / max) * (h - 16)
  }));
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.strokeStyle = palette.blue;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawGauge(chart, value) {
  const { ctx, w, h } = chart;
  clearChart(chart);
  const cx = w / 2;
  const cy = h * 0.82;
  const r = Math.min(w * 0.42, h * 0.76);
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.strokeStyle = "rgba(103,84,39,0.18)";
  ctx.stroke();
  const grad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  grad.addColorStop(0, palette.red);
  grad.addColorStop(0.45, palette.yellow);
  grad.addColorStop(1, palette.green);
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI + (value / 100) * Math.PI);
  ctx.strokeStyle = grad;
  ctx.stroke();
  ctx.fillStyle = palette.ink;
  ctx.font = "800 16px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(`${value.toFixed(0)}%`, cx, cy - 8);
}

function drawDonut(chart, data) {
  const { ctx, w, h } = chart;
  clearChart(chart);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  let angle = -Math.PI / 2;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.38;
  data.forEach(d => {
    const next = angle + (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, next);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    angle = next;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,253,235,0.97)";
  ctx.fill();
}

function drawRadar(chart, values) {
  const { ctx, w, h } = chart;
  clearChart(chart);
  const cx = w / 2;
  const cy = h / 2 + 2;
  const r = Math.min(w, h) * 0.38;
  const labels = ["PM", "FP", "Yield", "Drift", "EHS"];
  ctx.strokeStyle = palette.grid;
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    labels.forEach((_, i) => {
      const a = -Math.PI / 2 + (i / labels.length) * Math.PI * 2;
      const rr = r * ring / 4;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.beginPath();
  values.forEach((v, i) => {
    const a = -Math.PI / 2 + (i / values.length) * Math.PI * 2;
    const rr = r * v / 100;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(0, 171, 194, 0.28)";
  ctx.strokeStyle = palette.blue;
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
}

function drawHeatmap(chart, rows) {
  const { ctx, w, h } = chart;
  clearChart(chart);
  if (!rows.length) return;
  const gap = 3;
  const cols = rows[0].length;
  const cellW = (w - gap * (cols + 1)) / cols;
  const cellH = (h - gap * (rows.length + 1)) / rows.length;
  rows.forEach((row, y) => {
    row.forEach((value, x) => {
      const hueColor = value > 72 ? palette.red : value > 48 ? palette.yellow : palette.green;
      ctx.globalAlpha = 0.28 + value / 140;
      ctx.fillStyle = hueColor;
      ctx.fillRect(gap + x * (cellW + gap), gap + y * (cellH + gap), cellW, cellH);
    });
  });
  ctx.globalAlpha = 1;
}

function addEvent(type = "ok", machine = null, message = null) {
  const target = machine || simulationState.snapshots[Math.floor(Math.random() * simulationState.snapshots.length)] || machineConfig[0];
  const time = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  const messages = {
    ok: "Lot completed and released",
    warn: "Parameter drift detected",
    hot: "ACK timeout escalation",
    ack: "Engineer acknowledged alarm"
  };
  simulationState.events.unshift({
    time,
    type,
    machine: `${target.type} ${target.id}`,
    message: message || messages[type] || messages.ok
  });
  simulationState.events = simulationState.events.slice(0, 8);
}

function renderDashboard() {
  const data = generateMockDashboardData();
  runRenderStep("controls", () => renderControls());
  runRenderStep("kpis", () => renderKPIs(data));
  runRenderStep("equipment", () => renderEquipment(data));
  runRenderStep("environment", () => renderEnvironment(data));
  runRenderStep("workforce", () => renderWorkforce(data));
  runRenderStep("table", () => renderTable(data));
  runRenderStep("events", () => renderEvents(data));
  runRenderStep("charts", () => renderCharts(data));
  runRenderStep("factory", () => renderFactory(data));
}

function runRenderStep(name, renderStep) {
  try {
    renderStep();
  } catch (error) {
    window.__dashboardLastRenderError = { name, message: error.message };
    console.error(`Dashboard render step failed: ${name}`, error);
  }
}

function renderControls() {
  const { clock, shiftLabel, shiftToggle, togglePlay } = runtimeState.els;
  clock.textContent = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  shiftLabel.textContent = `${uiState.shift} Shift`;
  shiftToggle.textContent = `${uiState.shift} Shift`;
  togglePlay.textContent = simulationState.playing ? "Pause" : "Play";
  togglePlay.classList.toggle("active", !simulationState.playing);
}

function renderKPIs(data) {
  runtimeState.els.kpiStrip.innerHTML = data.kpis.map(kpi => `
    <div class="kpi" title="backend: ${data.endpoints.kpis}">
      <span>${kpi.label}</span>
      <span class="value">${kpi.value}${kpi.unit}</span>
      <span class="trend">${kpi.trend}</span>
    </div>
  `).join("");
}

function renderEquipment(data) {
  const { machine } = data;
  const { machineName, machineState, runTime, lastPm, lotType, toolKpi, machineStateDot } = runtimeState.els;
  machineName.textContent = machine.id;
  machineState.textContent = machine.status;
  runTime.textContent = machine.runTime;
  lastPm.textContent = machine.lastPm;
  lotType.textContent = machine.type;
  toolKpi.textContent = `${machine.uph} / ${machine.yield.toFixed(1)}%`;
  machineStateDot.style.background = stateColors[machine.status];
  machineStateDot.style.boxShadow = `0 0 14px ${stateColors[machine.status]}`;
}

function renderEnvironment(data) {
  runtimeState.els.tempValue.textContent = data.environment.temp;
  runtimeState.els.humidValue.textContent = data.environment.humidity;
  runtimeState.els.pressureValue.textContent = data.environment.pressure;
}

function renderWorkforce(data) {
  runtimeState.els.peopleList.innerHTML = data.workforce.map(item => `
    <div><span>${item.label}</span><b style="color:${item.color}">${item.value}</b></div>
  `).join("");
}

function renderTable(data) {
  runtimeState.els.alarmTable.innerHTML = data.table.map(row => `
    <tr>
      <td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td><td>${row[3]}</td>
      <td class="status"><span class="${row[5]}">${row[4]}</span></td>
    </tr>
  `).join("");
}

function renderEvents(data) {
  runtimeState.els.eventList.innerHTML = data.events.map(event => `
    <div class="event-item ${event.type}">
      <span>${event.time}</span>
      <span>${event.machine} - ${event.message}</span>
      <b>${event.type.toUpperCase()}</b>
    </div>
  `).join("");
}

function renderCharts(data) {
  const charts = runtimeState.charts;
  drawLine(charts.alarmTrend, data.trends.map(d => d.uph), palette.blue, true);
  drawBars(charts.alarmBars, data.trends.map(d => d.alarm), [palette.green, palette.yellow, palette.orange, palette.red]);
  drawMixed(charts.energyMixed, data.energy);
  drawLine(charts.utilityArea, data.utility, palette.orange, true);
  drawGauge(charts.gaugeChart, data.environment.gauge);
  drawMixed(charts.miniCombo, data.environment.bars.map((bar, i) => ({ bar, line: 38 + Math.sin(i + simulationState.tick * SIMULATION.UTIL_WAVE_SPEED) * 15 })));
  drawHeatmap(charts.environmentStatus, data.environment.riskRows);
  drawLine(charts.sparkArea, data.environment.spark, palette.red, true);
  drawDonut(charts.donutChart, data.workforce);
  drawRadar(charts.radarChart, data.analytics);
}

function renderFactory(data) {
  runtimeState.els.tools.forEach((tool, index) => {
    const machine = data.machines[index];
    const visible = uiState.filter === "ALL" || machine.type === uiState.filter;
    const light = tool.querySelector(".state-light");
    tool.classList.toggle("dimmed", !visible);
    tool.style.filter = index === uiState.selectedMachine ? "drop-shadow(0 0 12px #00abc2) brightness(1.08)" : "";
    light.style.background = stateColors[machine.status];
    light.style.color = stateColors[machine.status];
  });
}

function step() {
  if (!simulationState.playing) return;
  advanceSimulation();
  renderDashboard();
}

function startTimer() {
  stopTimer();
  runtimeState.timer = setInterval(step, simulationState.speed);
}

function stopTimer() {
  if (runtimeState.timer) {
    clearInterval(runtimeState.timer);
    runtimeState.timer = null;
  }
}

function destroyDashboard() {
  stopTimer();
  if (runtimeState.resizeHandler) {
    window.removeEventListener("resize", runtimeState.resizeHandler);
  }
}

function setupEvents() {
  runtimeState.els.cycleMachine.addEventListener("click", () => {
    const machines = visibleMachineConfigs();
    const currentVisibleIndex = machines.findIndex(machine => machineConfig.indexOf(machine) === uiState.selectedMachine);
    const next = machines[(currentVisibleIndex + 1 + machines.length) % machines.length];
    uiState.selectedMachine = machineConfig.indexOf(next);
    renderDashboard();
  });

  runtimeState.els.typeFilters.addEventListener("click", event => {
    if (!event.target.matches("button")) return;
    uiState.filter = event.target.dataset.type;
    runtimeState.els.typeFilters.querySelectorAll("button").forEach(button => button.classList.toggle("active", button === event.target));
    const machines = visibleMachineConfigs();
    if (!machines.includes(machineConfig[uiState.selectedMachine])) {
      uiState.selectedMachine = machineConfig.indexOf(machines[0]);
    }
    refreshDerivedState();
    addEvent("ack", simulationState.snapshots[uiState.selectedMachine], `Filter switched to ${uiState.filter}`);
    renderDashboard();
  });

  runtimeState.els.togglePlay.addEventListener("click", () => {
    simulationState.playing = !simulationState.playing;
    renderDashboard();
  });

  runtimeState.els.alarmBurst.addEventListener("click", () => {
    simulationState.alarmBoostUntil = simulationState.tick + SIMULATION.ALARM_BURST_TICKS;
    refreshMachineSnapshots();
    refreshDerivedState();
    addEvent("hot", simulationState.snapshots[uiState.selectedMachine], "Simulated alarm burst");
    renderDashboard();
  });

  runtimeState.els.simulateDown.addEventListener("click", () => {
    machineConfig[uiState.selectedMachine].forceDownUntil = simulationState.tick + SIMULATION.TOOL_DOWN_TICKS;
    refreshMachineSnapshots();
    refreshDerivedState();
    addEvent("hot", simulationState.snapshots[uiState.selectedMachine], "Tool down simulation started");
    renderDashboard();
  });

  runtimeState.els.shiftToggle.addEventListener("click", () => {
    uiState.shift = uiState.shift === "Day" ? "Night" : "Day";
    addEvent("ack", simulationState.snapshots[uiState.selectedMachine], `${uiState.shift} shift loaded`);
    renderDashboard();
  });

  runtimeState.els.speedRange.addEventListener("input", event => {
    simulationState.speed = Number(event.target.value);
    startTimer();
  });

  runtimeState.els.analyticsButtons.forEach(button => {
    button.addEventListener("click", () => {
      addEvent("ack", simulationState.snapshots[uiState.selectedMachine], `${button.textContent} requested`);
      button.animate([{ transform: "scale(1)" }, { transform: "scale(0.96)" }, { transform: "scale(1)" }], { duration: 180 });
      renderDashboard();
    });
  });

  runtimeState.resizeHandler = () => {
    resizeAllCharts();
    if (runtimeState.ready) renderDashboard();
  };
  window.addEventListener("resize", runtimeState.resizeHandler);
  window.addEventListener("beforeunload", destroyDashboard, { once: true });
}

function initDashboard() {
  cacheElements();
  refreshMachineSnapshots();
  refreshDerivedState();
  setupFactory();
  setupCharts();
  setupEvents();
  addEvent("ok", simulationState.snapshots[0], "Dashboard connected to mock stream");
  addEvent("warn", simulationState.snapshots[2], "Parameter drift detected");
  addEvent("ack", simulationState.snapshots[1], "Engineer acknowledged alarm");
  runtimeState.ready = true;
  renderDashboard();
  startTimer();
}

initDashboard();
