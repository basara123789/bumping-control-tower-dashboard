const endpointMap = {
  kpis: "/api/kpi/overview",
  machines: "/api/bumping/machines",
  alarms: "/api/alarm/history",
  facility: "/api/facility-energy/timeseries",
  environment: "/api/environment/status",
  workforce: "/api/workforce/status",
  analytics: "/api/ai-analytics/scores"
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

const state = {
  tick: 0,
  selectedMachine: 0,
  filter: "ALL",
  playing: true,
  speed: 1200,
  shift: "Day",
  alarmBoostUntil: 0,
  timer: null,
  events: [],
  machines: [
    { id: "COATER 01", type: "DRY", x: 92, y: 164, color: "pink", baseUph: 820, baseYield: 98.4, util: 88, statusSeed: 2 },
    { id: "CCATE 01", type: "WET1", x: 298, y: 82, color: "cyan", baseUph: 760, baseYield: 97.8, util: 84, statusSeed: 7 },
    { id: "CHEF 02", type: "WET2", x: 526, y: 102, color: "pink", baseUph: 715, baseYield: 97.2, util: 81, statusSeed: 11 },
    { id: "DEV 03", type: "DRY", x: 396, y: 170, color: "blue", baseUph: 845, baseYield: 98.7, util: 91, statusSeed: 4 },
    { id: "ETCH 08", type: "WET2", x: 636, y: 196, color: "cyan", baseUph: 700, baseYield: 96.8, util: 79, statusSeed: 15 },
    { id: "DRY 12", type: "DRY", x: 204, y: 34, color: "blue", baseUph: 835, baseYield: 98.9, util: 89, statusSeed: 19 }
  ]
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wave = (base, amp, speed, phase = 0) => base + Math.sin(state.tick * speed + phase) * amp;
const average = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const visibleMachines = () => state.machines.filter(machine => state.filter === "ALL" || machine.type === state.filter);

function machineSnapshot(machine, index) {
  const boosted = state.tick < state.alarmBoostUntil;
  const phase = machine.statusSeed + index * 0.7;
  const statusCycle = Math.sin(state.tick * 0.18 + phase);
  let status = "Running";
  if (statusCycle > 0.91) status = "Warning";
  if (statusCycle < -0.94) status = "Idle";
  if (machine.forceDownUntil && state.tick < machine.forceDownUntil) status = "Down";
  const statusPenalty = status === "Down" ? 0.42 : status === "Warning" ? 0.84 : status === "Idle" ? 0.72 : 1;
  const alarmMultiplier = boosted ? 2.2 : 1;
  const alarms = Math.max(0, Math.round((status === "Down" ? 6 : status === "Warning" ? 3 : status === "Idle" ? 1 : 0) * alarmMultiplier + Math.abs(Math.sin(state.tick * 0.31 + phase)) * 2));
  return {
    ...machine,
    status,
    uph: Math.round(wave(machine.baseUph, 28, 0.25, phase) * statusPenalty),
    yield: clamp(wave(machine.baseYield, 0.55, 0.16, phase) - (status === "Warning" ? 0.7 : 0) - (status === "Down" ? 3.2 : 0), 88, 99.6),
    util: clamp(wave(machine.util, 4.2, 0.2, phase) * statusPenalty, 0, 99),
    alarms,
    risk: clamp(alarms * 12 + (100 - machine.baseYield) * 8 + Math.abs(Math.sin(state.tick * 0.21 + phase)) * 20, 4, 98)
  };
}

function api() {
  const snapshots = state.machines.map(machineSnapshot);
  const scoped = snapshots.filter(machine => state.filter === "ALL" || machine.type === state.filter);
  const selected = snapshots[state.selectedMachine] || scoped[0] || snapshots[0];
  const alarmTotal = scoped.reduce((sum, machine) => sum + machine.alarms, 0);
  const health = 100 - average(scoped.map(machine => machine.risk)) * 0.42;
  return {
    endpoints: endpointMap,
    machines: snapshots,
    scopedMachines: scoped,
    machine: {
      ...selected,
      runTime: `${10 + (state.tick + state.selectedMachine) % 7}h ${String(24 + (state.tick * 3) % 36).padStart(2, "0")}m`,
      lastPm: `${3 + (state.selectedMachine % 5)} Days Ago`
    },
    kpis: [
      { label: "UPH", value: Math.round(average(scoped.map(machine => machine.uph))), unit: "", trend: "+3.2%" },
      { label: "OEE", value: clamp(average(scoped.map(machine => machine.util)) + 5, 0, 99).toFixed(1), unit: "%", trend: "+1.1%" },
      { label: "Yield", value: average(scoped.map(machine => machine.yield)).toFixed(1), unit: "%", trend: "+0.4%" },
      { label: "Utilization", value: Math.round(average(scoped.map(machine => machine.util))), unit: "%", trend: state.shift },
      { label: "Alarms", value: alarmTotal, unit: "", trend: alarmTotal > 12 ? "High" : "Normal" },
      { label: "AI Health", value: Math.round(health), unit: "%", trend: health > 78 ? "Stable" : "Watch" }
    ],
    trends: Array.from({ length: 12 }, (_, i) => ({
      uph: selected.uph * (0.92 + Math.sin(state.tick * 0.18 + i * 0.44) * 0.06),
      yield: selected.yield + Math.sin(state.tick * 0.15 + i * 0.5) * 0.7,
      alarm: 6 + selected.alarms * 5 + Math.abs(Math.sin(state.tick * 0.3 + i * 0.8)) * 30
    })),
    energy: Array.from({ length: 12 }, (_, i) => ({
      bar: 28 + Math.abs(Math.sin(state.tick * 0.22 + i * 0.65)) * 46 + scoped.length * 2,
      line: 58 - i * 1.8 + Math.sin(state.tick * 0.16 + i) * 7
    })),
    utility: Array.from({ length: 18 }, (_, i) => 24 + Math.sin(state.tick * 0.2 + i * 0.45) * 8 + i * 1.25 + scoped.length),
    environment: {
      temp: wave(23.5, 0.7, 0.2).toFixed(1),
      humidity: Math.round(wave(45, 4, 0.14)),
      pressure: Math.round(wave(-10, 3, 0.26)),
      gauge: clamp(selected.util, 0, 100),
      bars: Array.from({ length: 16 }, (_, i) => 18 + Math.abs(Math.sin(state.tick * 0.21 + i * 0.7)) * 46),
      riskRows: scoped.map((machine, row) => Array.from({ length: 10 }, (_, col) => clamp(machine.risk + Math.sin(state.tick * 0.19 + row + col * 0.6) * 18, 0, 100))),
      spark: scoped.map(machine => machine.risk)
    },
    workforce: [
      { label: "Online", value: Math.round(wave(state.shift === "Day" ? 45 : 31, 3, 0.12)), color: palette.cyan },
      { label: "No Badge", value: Math.round(wave(9, 2, 0.35)), color: palette.blue },
      { label: "Assist", value: Math.round(wave(3, 1, 0.28)), color: palette.violet },
      { label: "Support", value: Math.round(wave(state.shift === "Day" ? 12 : 7, 2, 0.18)), color: palette.orange }
    ],
    table: scoped.slice(0, 5).map((machine, index) => [
      machine.status === "Down" ? "Tool Down" : machine.status === "Warning" ? "Parameter Drift" : machine.alarms > 2 ? "ACK Timeout" : "Monitor",
      machine.id,
      `${String(8 + index + (state.tick % 8)).padStart(2, "0")}:${String((state.tick * 7 + index * 9) % 60).padStart(2, "0")}`,
      machine.type,
      machine.status === "Running" ? "Normal" : machine.status,
      machine.status === "Down" ? "hot" : machine.status === "Warning" ? "warn" : machine.status === "Idle" ? "ack" : "ok"
    ]),
    events: state.events.slice(0, 5),
    analytics: [
      82 - selected.alarms * 3 + Math.sin(state.tick * 0.2) * 4,
      72 + Math.cos(state.tick * 0.16) * 8 - selected.risk * 0.1,
      selected.yield,
      88 - Math.max(0, selected.risk - 35) * 0.35,
      selected.status === "Down" ? 45 : selected.status === "Warning" ? 66 : 86
    ].map(value => clamp(value, 0, 100))
  };
}

function setupFactory() {
  const scene = document.getElementById("factoryScene");
  state.machines.forEach((machine, index) => {
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
      state.selectedMachine = index;
      render();
    });
    tool.addEventListener("mousemove", event => showTooltip(event, index));
    tool.addEventListener("mouseleave", hideTooltip);
    scene.appendChild(tool);
  });
}

function showTooltip(event, index) {
  const tooltip = document.getElementById("machineTooltip");
  const sceneRect = document.getElementById("factoryScene").getBoundingClientRect();
  const machine = machineSnapshot(state.machines[index], index);
  tooltip.innerHTML = `
    <strong>${machine.type} ${machine.id}</strong>
    Status: ${machine.status}<br>
    UPH: ${machine.uph}<br>
    Yield: ${machine.yield.toFixed(1)}%<br>
    Utilization: ${machine.util.toFixed(0)}%<br>
    Alarms: ${machine.alarms}
  `;
  tooltip.style.left = `${event.clientX - sceneRect.left + 12}px`;
  tooltip.style.top = `${event.clientY - sceneRect.top - 6}px`;
  tooltip.style.display = "block";
}

function hideTooltip() {
  document.getElementById("machineTooltip").style.display = "none";
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(10, Math.floor(rect.width * dpr));
  canvas.height = Math.max(10, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

function clear(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 0, w, h);
}

function drawGrid(ctx, w, h, lines = 4) {
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

function drawBars(canvas, values, colors = [palette.orange, palette.blue, palette.violet, palette.cyan]) {
  const { ctx, w, h } = resizeCanvas(canvas);
  clear(ctx, w, h);
  drawGrid(ctx, w, h);
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

function drawLine(canvas, values, color = palette.blue, fill = false) {
  const { ctx, w, h } = resizeCanvas(canvas);
  clear(ctx, w, h);
  drawGrid(ctx, w, h);
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

function drawMixed(canvas, data) {
  const { ctx, w, h } = resizeCanvas(canvas);
  clear(ctx, w, h);
  drawGrid(ctx, w, h);
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

function drawGauge(canvas, value) {
  const { ctx, w, h } = resizeCanvas(canvas);
  clear(ctx, w, h);
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

function drawDonut(canvas, data) {
  const { ctx, w, h } = resizeCanvas(canvas);
  clear(ctx, w, h);
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

function drawRadar(canvas, values) {
  const { ctx, w, h } = resizeCanvas(canvas);
  clear(ctx, w, h);
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

function drawHeatmap(canvas, rows) {
  const { ctx, w, h } = resizeCanvas(canvas);
  clear(ctx, w, h);
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
  const target = machine || state.machines[Math.floor(Math.random() * state.machines.length)];
  const time = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  const messages = {
    ok: "Lot completed and released",
    warn: "Parameter drift detected",
    hot: "ACK timeout escalation",
    ack: "Engineer acknowledged alarm"
  };
  state.events.unshift({
    time,
    type,
    machine: `${target.type} ${target.id}`,
    message: message || messages[type] || messages.ok
  });
  state.events = state.events.slice(0, 8);
}

function render() {
  const data = api();
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  document.getElementById("shiftLabel").textContent = `${state.shift} Shift`;
  document.getElementById("shiftToggle").textContent = `${state.shift} Shift`;
  document.getElementById("togglePlay").textContent = state.playing ? "Pause" : "Play";
  document.getElementById("togglePlay").classList.toggle("active", !state.playing);

  document.getElementById("kpiStrip").innerHTML = data.kpis.map(kpi => `
    <div class="kpi" title="backend: ${data.endpoints.kpis}">
      <span>${kpi.label}</span>
      <span class="value">${kpi.value}${kpi.unit}</span>
      <span class="trend">${kpi.trend}</span>
    </div>
  `).join("");

  document.getElementById("machineName").textContent = data.machine.id;
  document.getElementById("machineState").textContent = data.machine.status;
  document.getElementById("runTime").textContent = data.machine.runTime;
  document.getElementById("lastPm").textContent = data.machine.lastPm;
  document.getElementById("lotType").textContent = data.machine.type;
  document.getElementById("toolKpi").textContent = `${data.machine.uph} / ${data.machine.yield.toFixed(1)}%`;
  const stateDot = document.getElementById("machineStateDot");
  stateDot.style.background = stateColors[data.machine.status];
  stateDot.style.boxShadow = `0 0 14px ${stateColors[data.machine.status]}`;

  document.getElementById("tempValue").textContent = data.environment.temp;
  document.getElementById("humidValue").textContent = data.environment.humidity;
  document.getElementById("pressureValue").textContent = data.environment.pressure;

  document.getElementById("peopleList").innerHTML = data.workforce.map(item => `
    <div><span>${item.label}</span><b style="color:${item.color}">${item.value}</b></div>
  `).join("");

  document.getElementById("alarmTable").innerHTML = data.table.map(row => `
    <tr>
      <td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td><td>${row[3]}</td>
      <td class="status"><span class="${row[5]}">${row[4]}</span></td>
    </tr>
  `).join("");

  document.getElementById("eventList").innerHTML = data.events.map(event => `
    <div class="event-item ${event.type}">
      <span>${event.time}</span>
      <span>${event.machine} - ${event.message}</span>
      <b>${event.type.toUpperCase()}</b>
    </div>
  `).join("");

  drawLine(document.getElementById("alarmTrend"), data.trends.map(d => d.uph), palette.blue, true);
  drawBars(document.getElementById("alarmBars"), data.trends.map(d => d.alarm), [palette.green, palette.yellow, palette.orange, palette.red]);
  drawMixed(document.getElementById("energyMixed"), data.energy);
  drawLine(document.getElementById("utilityArea"), data.utility, palette.orange, true);
  drawGauge(document.getElementById("gaugeChart"), data.environment.gauge);
  drawMixed(document.getElementById("miniCombo"), data.environment.bars.map((bar, i) => ({ bar, line: 38 + Math.sin(i + state.tick * 0.2) * 15 })));
  drawHeatmap(document.getElementById("environmentStatus"), data.environment.riskRows);
  drawLine(document.getElementById("sparkArea"), data.environment.spark, palette.red, true);
  drawDonut(document.getElementById("donutChart"), data.workforce);
  drawRadar(document.getElementById("radarChart"), data.analytics);

  document.querySelectorAll(".tool").forEach((tool, index) => {
    const machine = data.machines[index];
    const visible = state.filter === "ALL" || machine.type === state.filter;
    const light = tool.querySelector(".state-light");
    tool.classList.toggle("dimmed", !visible);
    tool.style.filter = index === state.selectedMachine ? "drop-shadow(0 0 12px #00abc2) brightness(1.08)" : "";
    light.style.background = stateColors[machine.status];
    light.style.color = stateColors[machine.status];
  });
}

function step() {
  if (!state.playing) return;
  state.tick += 1;
  if (state.tick % 4 === 0) {
    const snapshots = state.machines.map(machineSnapshot);
    const risky = snapshots.sort((a, b) => b.risk - a.risk)[0];
    addEvent(risky.status === "Running" ? "ok" : risky.status === "Warning" ? "warn" : risky.status === "Down" ? "hot" : "ack", risky);
  }
  render();
}

function restartTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(step, state.speed);
}

document.getElementById("cycleMachine").addEventListener("click", () => {
  const machines = visibleMachines();
  const currentVisibleIndex = machines.findIndex(machine => state.machines.indexOf(machine) === state.selectedMachine);
  const next = machines[(currentVisibleIndex + 1 + machines.length) % machines.length];
  state.selectedMachine = state.machines.indexOf(next);
  render();
});

document.getElementById("typeFilters").addEventListener("click", event => {
  if (!event.target.matches("button")) return;
  state.filter = event.target.dataset.type;
  document.querySelectorAll("#typeFilters button").forEach(button => button.classList.toggle("active", button === event.target));
  const machines = visibleMachines();
  if (!machines.includes(state.machines[state.selectedMachine])) {
    state.selectedMachine = state.machines.indexOf(machines[0]);
  }
  addEvent("ack", machines[0], `Filter switched to ${state.filter}`);
  render();
});

document.getElementById("togglePlay").addEventListener("click", () => {
  state.playing = !state.playing;
  render();
});

document.getElementById("alarmBurst").addEventListener("click", () => {
  state.alarmBoostUntil = state.tick + 8;
  addEvent("hot", state.machines[state.selectedMachine], "Simulated alarm burst");
  render();
});

document.getElementById("simulateDown").addEventListener("click", () => {
  state.machines[state.selectedMachine].forceDownUntil = state.tick + 10;
  addEvent("hot", state.machines[state.selectedMachine], "Tool down simulation started");
  render();
});

document.getElementById("shiftToggle").addEventListener("click", () => {
  state.shift = state.shift === "Day" ? "Night" : "Day";
  addEvent("ack", state.machines[state.selectedMachine], `${state.shift} shift loaded`);
  render();
});

document.getElementById("speedRange").addEventListener("input", event => {
  state.speed = Number(event.target.value);
  restartTimer();
});

document.querySelectorAll(".analytics-actions button").forEach(button => {
  button.addEventListener("click", () => {
    addEvent("ack", state.machines[state.selectedMachine], `${button.textContent} requested`);
    button.animate([{ transform: "scale(1)" }, { transform: "scale(0.96)" }, { transform: "scale(1)" }], { duration: 180 });
    render();
  });
});

window.addEventListener("resize", render);
setupFactory();
addEvent("ok", state.machines[0], "Dashboard connected to mock stream");
addEvent("warn", state.machines[2], "Parameter drift detected");
addEvent("ack", state.machines[1], "Engineer acknowledged alarm");
render();
restartTimer();
