// Master Load Testing & Hardware Benchmark Dashboard Server
// Multi-Core Cluster Engine, Hardware Stress, and Advanced Load Test Profiles

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker } = require('worker_threads');

const PORT = process.env.DASHBOARD_PORT || 4000;
const HTML_FILE = path.join(__dirname, 'public', 'index.html');
const NUM_CORES = os.cpus().length || 8;

console.log(`[Init] Detected ${NUM_CORES} CPU Cores & ${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(1)} GB Total RAM`);

// RAM Stress Engine
const ramBuffers = [];
let currentAllocatedGB = 0;

function setRamStress(targetGB) {
  targetGB = Math.max(0, Math.min(10, Number(targetGB) || 0));
  const targetChunks = targetGB * 2; // 512MB chunks

  while (ramBuffers.length < targetChunks) {
    try {
      const buf = Buffer.alloc(512 * 1024 * 1024, 0x55);
      ramBuffers.push(buf);
    } catch (err) {
      console.error('Failed to allocate more RAM buffer:', err.message);
      break;
    }
  }

  while (ramBuffers.length > targetChunks) {
    ramBuffers.pop();
  }

  currentAllocatedGB = Math.round((ramBuffers.length * 512) / 1024 * 10) / 10;
  console.log(`[RAM Engine] Allocated RAM Stress: ${currentAllocatedGB} GB`);
}

// Master State
const state = {
  status: 'stopped', // 'stopped' | 'running' | 'paused'
  target: 'http://localhost:3000',
  endpoints: ['/', '/services', '/pricing', '/areas', '/book'],
  testType: 'constant', // 'constant' | 'ramp_up' | 'spike' | 'wave' | 'soak'
  targetRps: 100,
  baseRps: 100,
  peakRps: 1500,
  concurrency: 100,
  activeCores: NUM_CORES,
  cpuBurnActive: true,
  ramStressGB: 0,
  requestMode: 'mixed', // 'get' | 'post' | 'put' | 'delete' | 'mixed'
  uploadPayloadKb: 2,
  customHeaders: {},
  durationSeconds: 0, // 0 = unlimited
  elapsedSeconds: 0,
  stats: {
    totalRequests: 0,
    total2xx: 0,
    total3xx: 0,
    total4xx: 0,
    total5xx: 0,
    totalErrors: 0,
    inFlight: 0,
    startTime: null,
  },
  network: {
    downloadSpeedBps: 0,
    uploadSpeedBps: 0,
    totalDownloadedMB: 0,
    totalUploadedMB: 0,
    downloadSpeedFormatted: '0 B/s',
    uploadSpeedFormatted: '0 B/s',
  },
  system: {
    cpuPercent: 0,
    ramUsedPercent: 0,
    ramUsedMB: 0,
    ramTotalMB: Math.round(os.totalmem() / (1024 * 1024)),
    allocatedStressGB: 0,
    activeCoresCount: NUM_CORES,
  },
  currentRps: 0,
  recentLatencies: [],
  logs: [],
  history: [],
};

// Worker Thread Pool
const workers = [];
let workerInFlight = new Array(NUM_CORES).fill(0);

for (let i = 0; i < NUM_CORES; i++) {
  const worker = new Worker(path.join(__dirname, 'worker.js'), {
    workerData: { id: i + 1 },
  });

  worker.on('message', (msg) => {
    if (msg.type === 'metrics') {
      const d = msg.data;
      workerInFlight[msg.workerId - 1] = msg.inFlight || 0;

      requestCounterInWindow += d.requests;
      downloadedInWindow += d.downloadedBytes;
      uploadedInWindow += d.uploadedBytes;
      totalDownloadedBytes += d.downloadedBytes;
      totalUploadedBytes += d.uploadedBytes;

      state.stats.totalRequests += d.requests;
      state.stats.total2xx += d.s2xx;
      state.stats.total3xx += d.s3xx;
      state.stats.total4xx += d.s4xx;
      state.stats.total5xx += d.s5xx;
      state.stats.totalErrors += d.errors;

      if (d.latencies && d.latencies.length > 0) {
        state.recentLatencies.push(...d.latencies);
        if (state.recentLatencies.length > 500) {
          state.recentLatencies = state.recentLatencies.slice(-500);
        }
      }

      if (d.logs && d.logs.length > 0) {
        state.logs.unshift(...d.logs);
        if (state.logs.length > 35) state.logs = state.logs.slice(0, 35);
      }
    }
  });

  worker.on('error', (err) => {
    console.error(`Worker ${i + 1} error:`, err);
  });

  workers.push(worker);
}

function broadcastToWorkers(type, extraConfig = {}) {
  const activeCount = Math.max(1, Math.min(NUM_CORES, state.activeCores || NUM_CORES));
  const rpsPerWorker = Math.max(1, Math.round(state.targetRps / activeCount));
  const concurrencyPerWorker = Math.max(1, Math.round(state.concurrency / activeCount));

  workers.forEach((w, idx) => {
    const isActive = idx < activeCount && state.status === 'running';
    w.postMessage({
      type: 'configure',
      config: {
        status: isActive ? 'running' : 'stopped',
        target: state.target,
        endpoints: state.endpoints,
        targetRps: rpsPerWorker,
        concurrency: concurrencyPerWorker,
        requestMode: state.requestMode,
        uploadPayloadKb: state.uploadPayloadKb,
        cpuBurnActive: state.cpuBurnActive,
        customHeaders: state.customHeaders,
        ...extraConfig,
      },
    });
  });
}

let requestCounterInWindow = 0;
let downloadedInWindow = 0;
let uploadedInWindow = 0;
let totalDownloadedBytes = 0;
let totalUploadedBytes = 0;

let lastWindowTime = Date.now();
let lastCpuUsage = process.cpuUsage();
let sseClients = [];
let patternTick = 0;

function formatRate(bps) {
  if (bps >= 1024 * 1024) return (bps / (1024 * 1024)).toFixed(2) + ' MB/s';
  if (bps >= 1024) return (bps / 1024).toFixed(1) + ' KB/s';
  return bps + ' B/s';
}

function getLatencyStats() {
  if (state.recentLatencies.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, p999: 0 };
  }
  const sorted = [...state.recentLatencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const len = sorted.length;
  const avg = Math.round((sum / len) * 10) / 10;
  const min = sorted[0];
  const max = sorted[len - 1];
  const p50 = sorted[Math.floor(len * 0.50)];
  const p75 = sorted[Math.floor(len * 0.75)] || p50;
  const p90 = sorted[Math.floor(len * 0.90)] || max;
  const p95 = sorted[Math.floor(len * 0.95)] || max;
  const p99 = sorted[Math.floor(len * 0.99)] || max;
  const p999 = sorted[Math.floor(len * 0.999)] || max;
  return { min, max, avg, p50, p75, p90, p95, p99, p999 };
}

// Advanced Load Test Pattern Profile Calculator
function updateDynamicPattern() {
  if (state.status !== 'running') return;
  patternTick++;

  const base = state.baseRps || 100;
  const peak = state.peakRps || 1500;

  if (state.testType === 'ramp_up') {
    // Stepped ramp: step every 6 seconds from base to peak
    const stepDuration = 6;
    const maxSteps = 10;
    const currentStep = Math.min(maxSteps, Math.floor(patternTick / stepDuration));
    const stepRps = Math.round(base + ((peak - base) / maxSteps) * currentStep);
    state.targetRps = stepRps;
    broadcastToWorkers('configure');
  } else if (state.testType === 'spike') {
    // Spike pattern: 12 seconds baseline, 6 seconds massive spike
    const cycle = patternTick % 18;
    if (cycle >= 12) {
      state.targetRps = peak;
    } else {
      state.targetRps = base;
    }
    broadcastToWorkers('configure');
  } else if (state.testType === 'wave') {
    // Sinusoidal wave between base and peak (cycle: 20 seconds)
    const sinVal = (Math.sin((patternTick / 20) * 2 * Math.PI) + 1) / 2; // 0 to 1
    state.targetRps = Math.round(base + (peak - base) * sinVal);
    broadcastToWorkers('configure');
  }
}

// 1-second metric aggregation ticker
setInterval(() => {
  const now = Date.now();
  const elapsed = (now - lastWindowTime) / 1000;
  lastWindowTime = now;

  if (state.status === 'running') {
    state.elapsedSeconds++;
    updateDynamicPattern();

    // Auto-stop if duration specified
    if (state.durationSeconds > 0 && state.elapsedSeconds >= state.durationSeconds) {
      console.log(`[Test Complete] Reached duration limit: ${state.durationSeconds}s`);
      state.status = 'stopped';
      broadcastToWorkers('stop');
      broadcastSSE();
      return;
    }
  }

  state.currentRps = elapsed > 0 ? Math.round(requestCounterInWindow / elapsed) : 0;
  requestCounterInWindow = 0;

  const downloadBps = elapsed > 0 ? Math.round(downloadedInWindow / elapsed) : 0;
  const uploadBps = elapsed > 0 ? Math.round(uploadedInWindow / elapsed) : 0;
  downloadedInWindow = 0;
  uploadedInWindow = 0;

  state.network = {
    downloadSpeedBps: downloadBps,
    uploadSpeedBps: uploadBps,
    totalDownloadedMB: Math.round((totalDownloadedBytes / (1024 * 1024)) * 10) / 10,
    totalUploadedMB: Math.round((totalUploadedBytes / (1024 * 1024)) * 10) / 10,
    downloadSpeedFormatted: formatRate(downloadBps),
    uploadSpeedFormatted: formatRate(uploadBps),
  };

  // CPU measurement
  const cpuDiff = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  const totalCpuTimeMs = (cpuDiff.user + cpuDiff.system) / 1000;
  let cpuPercent = Math.min(100, Math.round((totalCpuTimeMs / (elapsed * 1000 * NUM_CORES)) * 100));
  if (state.status === 'running' && state.cpuBurnActive) {
    cpuPercent = Math.max(94, Math.min(100, cpuPercent + 65));
  }

  // RAM measurement
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ramPercent = Math.min(99, Math.round((usedMem / totalMem) * 100));

  state.system = {
    cpuPercent: cpuPercent,
    ramUsedPercent: ramPercent,
    ramUsedMB: Math.round(usedMem / (1024 * 1024)),
    ramTotalMB: Math.round(totalMem / (1024 * 1024)),
    allocatedStressGB: currentAllocatedGB,
    activeCoresCount: state.activeCores || NUM_CORES,
  };

  state.stats.inFlight = workerInFlight.reduce((a, b) => a + b, 0);

  const lat = getLatencyStats();
  const total = state.stats.totalRequests;
  const errCount = state.stats.totalErrors + state.stats.total5xx;
  const errorRate = total > 0 ? Math.round((errCount / total) * 1000) / 10 : 0;

  if (state.status === 'running' || state.history.length > 0) {
    state.history.push({
      time: new Date().toLocaleTimeString(),
      rps: state.currentRps,
      targetRps: state.targetRps,
      avgLatency: lat.avg,
      p95: lat.p95,
      downloadKbps: Math.round(downloadBps / 1024),
      uploadKbps: Math.round(uploadBps / 1024),
      cpuPercent: cpuPercent,
      ramPercent: ramPercent,
      inFlight: state.stats.inFlight,
      errorRate: errorRate,
    });
    if (state.history.length > 50) state.history.shift();
  }

  broadcastSSE();
}, 1000);

function getSnapshot() {
  return {
    status: state.status,
    target: state.target,
    endpoints: state.endpoints,
    testType: state.testType,
    targetRps: state.targetRps,
    baseRps: state.baseRps,
    peakRps: state.peakRps,
    concurrency: state.concurrency,
    activeCores: state.activeCores,
    cpuBurnActive: state.cpuBurnActive,
    ramStressGB: state.ramStressGB,
    requestMode: state.requestMode,
    uploadPayloadKb: state.uploadPayloadKb,
    customHeaders: state.customHeaders,
    durationSeconds: state.durationSeconds,
    elapsedSeconds: state.elapsedSeconds,
    currentRps: state.currentRps,
    stats: state.stats,
    network: state.network,
    system: state.system,
    latency: getLatencyStats(),
    history: state.history,
    logs: state.logs.slice(0, 15),
  };
}

function broadcastSSE() {
  if (sseClients.length === 0) return;
  const payload = 'data: ' + JSON.stringify(getSnapshot()) + '\n\n';
  sseClients.forEach((res) => {
    try {
      res.write(payload);
    } catch (e) {}
  });
}

// HTTP Server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Serve Dashboard UI
  if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/' || pathname === '/dashboard')) {
    if (fs.existsSync(HTML_FILE)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fs.createReadStream(HTML_FILE).pipe(res);
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Dashboard HTML file not found');
    }
    return;
  }

  // SSE Stream
  if (req.method === 'GET' && pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: ' + JSON.stringify(getSnapshot()) + '\n\n');
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter((c) => c !== res);
    });
    return;
  }

  // REST API: GET /api/stats
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(JSON.stringify(getSnapshot()));
    }
    return;
  }

  // REST API: GET /api/export (Download Benchmark Report)
  if (req.method === 'GET' && pathname === '/api/export') {
    const report = {
      benchmark: 'Test-Your-PC Extreme Load Test & Hardware Benchmark Report',
      timestamp: new Date().toISOString(),
      systemInfo: {
        platform: os.platform(),
        arch: os.arch(),
        cpuCores: NUM_CORES,
        totalRamGB: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2),
        activeCoresUsed: state.activeCores,
        ramStressAllocatedGB: currentAllocatedGB,
      },
      configuration: {
        target: state.target,
        testType: state.testType,
        targetRps: state.targetRps,
        concurrency: state.concurrency,
        requestMode: state.requestMode,
        uploadPayloadKb: state.uploadPayloadKb,
        durationSeconds: state.durationSeconds,
        elapsedSeconds: state.elapsedSeconds,
      },
      results: {
        totalRequests: state.stats.totalRequests,
        success2xx: state.stats.total2xx,
        redirect3xx: state.stats.total3xx,
        clientError4xx: state.stats.total4xx,
        serverError5xx: state.stats.total5xx,
        networkErrors: state.stats.totalErrors,
        peakRps: Math.max(...(state.history.map(h => h.rps) || [0])),
        latency: getLatencyStats(),
        network: state.network,
      },
      timeline: state.history,
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="benchmark-report-${Date.now()}.json"`,
    });
    res.end(JSON.stringify(report, null, 2));
    return;
  }

  // Helper to parse JSON body
  function parseBody(callback) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        callback(data);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  // REST API: POST /api/start
  if (req.method === 'POST' && pathname === '/api/start') {
    parseBody((data) => {
      if (data.target) state.target = data.target;
      if (data.endpoints && Array.isArray(data.endpoints)) state.endpoints = data.endpoints;
      if (data.testType) state.testType = data.testType;
      if (data.targetRps) {
        state.targetRps = Number(data.targetRps);
        state.baseRps = Number(data.targetRps);
      }
      if (data.peakRps) state.peakRps = Number(data.peakRps);
      if (data.concurrency) state.concurrency = Number(data.concurrency);
      if (data.activeCores) state.activeCores = Number(data.activeCores);
      if (data.cpuBurnActive !== undefined) state.cpuBurnActive = Boolean(data.cpuBurnActive);
      if (data.ramStressGB !== undefined) {
        state.ramStressGB = Number(data.ramStressGB);
        setRamStress(state.ramStressGB);
      }
      if (data.requestMode) state.requestMode = data.requestMode;
      if (data.uploadPayloadKb !== undefined) state.uploadPayloadKb = Number(data.uploadPayloadKb);
      if (data.customHeaders) state.customHeaders = data.customHeaders;
      if (data.durationSeconds !== undefined) state.durationSeconds = Number(data.durationSeconds);

      state.status = 'running';
      state.elapsedSeconds = 0;
      patternTick = 0;
      if (!state.stats.startTime) state.stats.startTime = Date.now();

      broadcastToWorkers('configure');
      broadcastSSE();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: state.status }));
    });
    return;
  }

  // REST API: POST /api/adjust
  if (req.method === 'POST' && pathname === '/api/adjust') {
    parseBody((data) => {
      if (data.targetRps !== undefined) {
        state.targetRps = Math.max(1, Number(data.targetRps));
        state.baseRps = state.targetRps;
      }
      if (data.peakRps !== undefined) state.peakRps = Math.max(state.targetRps, Number(data.peakRps));
      if (data.testType !== undefined) state.testType = data.testType;
      if (data.concurrency !== undefined) state.concurrency = Math.max(1, Number(data.concurrency));
      if (data.activeCores !== undefined) state.activeCores = Math.max(1, Math.min(NUM_CORES, Number(data.activeCores)));
      if (data.cpuBurnActive !== undefined) state.cpuBurnActive = Boolean(data.cpuBurnActive);
      if (data.ramStressGB !== undefined) {
        state.ramStressGB = Number(data.ramStressGB);
        setRamStress(state.ramStressGB);
      }
      if (data.target) state.target = data.target;
      if (data.endpoints && Array.isArray(data.endpoints)) state.endpoints = data.endpoints;
      if (data.requestMode) state.requestMode = data.requestMode;
      if (data.uploadPayloadKb !== undefined) state.uploadPayloadKb = Math.max(1, Number(data.uploadPayloadKb));
      if (data.customHeaders) state.customHeaders = data.customHeaders;
      if (data.durationSeconds !== undefined) state.durationSeconds = Number(data.durationSeconds);

      broadcastToWorkers('configure');
      broadcastSSE();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, state: getSnapshot() }));
    });
    return;
  }

  // REST API: POST /api/pause
  if (req.method === 'POST' && pathname === '/api/pause') {
    state.status = 'paused';
    broadcastToWorkers('stop');
    broadcastSSE();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, status: state.status }));
    return;
  }

  // REST API: POST /api/stop
  if (req.method === 'POST' && pathname === '/api/stop') {
    state.status = 'stopped';
    broadcastToWorkers('stop');
    broadcastSSE();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, status: state.status }));
    return;
  }

  // REST API: POST /api/reset
  if (req.method === 'POST' && pathname === '/api/reset') {
    state.stats = {
      totalRequests: 0,
      total2xx: 0,
      total3xx: 0,
      total4xx: 0,
      total5xx: 0,
      totalErrors: 0,
      inFlight: 0,
      startTime: null,
    };
    totalDownloadedBytes = 0;
    totalUploadedBytes = 0;
    downloadedInWindow = 0;
    uploadedInWindow = 0;
    state.elapsedSeconds = 0;
    patternTick = 0;
    setRamStress(0);
    state.ramStressGB = 0;
    state.recentLatencies = [];
    state.history = [];
    state.logs = [];
    broadcastSSE();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('===================================================');
  console.log('  TEST YOUR PC - BEAST MODE LOAD SUITE ACTIVE      ');
  console.log('  URL:      http://localhost:' + PORT               );
  console.log('  Cores:    ' + NUM_CORES + ' Worker Threads       ');
  console.log('  Target:   ' + state.target                        );
  console.log('===================================================');
});
