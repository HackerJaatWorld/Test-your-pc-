// Multi-Core High-Power Load Worker Thread
// Supports multi-core HTTP generation, custom headers, payload stress, and CPU burner

const { parentPort, workerData } = require('worker_threads');
const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');

const workerId = workerData ? workerData.id : 0;

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 500 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 500 });

let config = {
  status: 'stopped',
  target: 'http://localhost:3000',
  endpoints: ['/', '/services', '/pricing', '/areas', '/book'],
  targetRps: 20,
  concurrency: 25,
  requestMode: 'mixed', // 'get' | 'post' | 'put' | 'delete' | 'mixed'
  uploadPayloadKb: 2,
  cpuBurnActive: false,
  customHeaders: {},
  timeoutMs: 8000,
};

let inFlight = 0;
let generatorInterval = null;
let cpuBurnerInterval = null;

let batchStats = {
  requests: 0,
  s2xx: 0,
  s3xx: 0,
  s4xx: 0,
  s5xx: 0,
  errors: 0,
  latencies: [],
  downloadedBytes: 0,
  uploadedBytes: 0,
  logs: [],
};

// Continuous CPU Burner: Keeps the CPU core at 100% when active
function startCpuBurner() {
  if (cpuBurnerInterval) clearInterval(cpuBurnerInterval);
  if (!config.cpuBurnActive || config.status !== 'running') return;

  const data = Buffer.alloc(4096, 'A');
  cpuBurnerInterval = setInterval(() => {
    if (!config.cpuBurnActive || config.status !== 'running') return;
    const start = Date.now();
    // Burn CPU in tight cycles
    while (Date.now() - start < 15) {
      crypto.createHash('sha512').update(data).digest();
    }
  }, 16);
}

function resolveMethod() {
  const mode = (config.requestMode || 'mixed').toLowerCase();
  if (mode === 'get') return 'GET';
  if (mode === 'post') return 'POST';
  if (mode === 'put') return 'PUT';
  if (mode === 'delete') return 'DELETE';
  if (mode === 'patch') return 'PATCH';
  
  // Mixed mode
  const r = Math.random();
  if (r < 0.60) return 'GET';
  if (r < 0.85) return 'POST';
  if (r < 0.95) return 'PUT';
  return 'DELETE';
}

function sendOneRequest() {
  if (config.status !== 'running') return;
  if (inFlight >= config.concurrency) return;

  const method = resolveMethod();
  const isWriteMethod = method === 'POST' || method === 'PUT' || method === 'PATCH';

  let endpoint = config.endpoints[Math.floor(Math.random() * config.endpoints.length)] || '/';
  if (isWriteMethod && endpoint === '/') {
    endpoint = '/api/bookings';
  }

  const targetUrlStr = config.target.replace(/\/+$/, '') + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
  let parsed;
  try {
    parsed = new url.URL(targetUrlStr);
  } catch (err) {
    return;
  }

  let payloadBuffer = null;
  if (isWriteMethod) {
    const targetBytes = Math.max(256, (config.uploadPayloadKb || 1) * 1024);
    const padding = 'X'.repeat(Math.max(0, targetBytes - 160));
    const postData = JSON.stringify({
      name: 'BeastModeVU_' + workerId,
      phone: '9988776655',
      service: 'Air Conditioner',
      village: 'Kosi',
      issue: 'Full stretch max power test',
      pad: padding,
    });
    payloadBuffer = Buffer.from(postData, 'utf8');
  }

  const startTime = Date.now();
  inFlight++;
  batchStats.requests++;

  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;
  const agent = isHttps ? httpsAgent : httpAgent;

  const headers = {
    'User-Agent': 'TestYourPC-BeastModeCluster/' + workerId,
    'Accept': '*/*',
    ...(config.customHeaders || {}),
  };

  if (payloadBuffer) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    headers['Content-Length'] = payloadBuffer.length;
    batchStats.uploadedBytes += payloadBuffer.length;
  } else {
    batchStats.uploadedBytes += 120;
  }

  const req = lib.request(
    parsed,
    {
      method,
      agent,
      headers,
      timeout: config.timeoutMs || 8000,
    },
    (res) => {
      res.on('data', (chunk) => {
        batchStats.downloadedBytes += chunk.length;
      });
      res.on('end', () => {
        inFlight = Math.max(0, inFlight - 1);
        const duration = Date.now() - startTime;
        record(res.statusCode, duration, null, endpoint, method);
      });
    }
  );

  req.on('error', (err) => {
    inFlight = Math.max(0, inFlight - 1);
    const duration = Date.now() - startTime;
    record(0, duration, err.message, endpoint, method);
  });

  req.on('timeout', () => {
    req.destroy(new Error('Timeout'));
  });

  if (payloadBuffer) {
    req.write(payloadBuffer);
  }
  req.end();
}

function record(statusCode, latency, err, endpoint, method) {
  if (statusCode >= 200 && statusCode < 300) batchStats.s2xx++;
  else if (statusCode >= 300 && statusCode < 400) batchStats.s3xx++;
  else if (statusCode >= 400 && statusCode < 500) batchStats.s4xx++;
  else if (statusCode >= 500) batchStats.s5xx++;
  else batchStats.errors++;

  if (latency > 0) {
    batchStats.latencies.push(latency);
  }

  if (batchStats.logs.length < 5) {
    batchStats.logs.push({
      time: new Date().toLocaleTimeString(),
      method: method || 'GET',
      endpoint,
      statusCode: statusCode || 'ERR',
      latency,
      error: err || null,
      worker: workerId,
    });
  }
}

function startGenerator() {
  if (generatorInterval) clearInterval(generatorInterval);
  if (config.status !== 'running') return;

  const intervalMs = 20; // 50 ticks/sec
  const reqPerTick = (config.targetRps * intervalMs) / 1000;
  let accumulator = 0;

  generatorInterval = setInterval(() => {
    if (config.status !== 'running') return;
    accumulator += reqPerTick;
    while (accumulator >= 1) {
      sendOneRequest();
      accumulator -= 1;
    }
  }, intervalMs);

  startCpuBurner();
}

// Flush metrics back to parent every 200ms
setInterval(() => {
  if (batchStats.requests > 0 || batchStats.latencies.length > 0) {
    parentPort.postMessage({
      type: 'metrics',
      workerId,
      inFlight,
      data: { ...batchStats },
    });
    batchStats = {
      requests: 0,
      s2xx: 0,
      s3xx: 0,
      s4xx: 0,
      s5xx: 0,
      errors: 0,
      latencies: [],
      downloadedBytes: 0,
      uploadedBytes: 0,
      logs: [],
    };
  }
}, 200);

// Listen for parent messages
parentPort.on('message', (msg) => {
  if (msg.type === 'configure') {
    Object.assign(config, msg.config);
    if (config.status === 'running') {
      startGenerator();
    } else {
      if (generatorInterval) clearInterval(generatorInterval);
      if (cpuBurnerInterval) clearInterval(cpuBurnerInterval);
    }
  } else if (msg.type === 'stop') {
    config.status = 'stopped';
    if (generatorInterval) clearInterval(generatorInterval);
    if (cpuBurnerInterval) clearInterval(cpuBurnerInterval);
  }
});
