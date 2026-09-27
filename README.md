# ⚡ Test-Your-PC: Extreme Multi-Core Hardware Benchmark & HTTP Load Testing Suite

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Android%20%7C%20PC-blue.svg)](#)
[![Multi-Core](https://img.shields.io/badge/Multi--Core-Worker--Threads-orange.svg)](#)
[![RAM Stress](https://img.shields.io/badge/RAM--Stress-Up%20to%2010GB%2B-purple.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-brightgreen.svg)](#)

A high-performance, real-time interactive **Hardware Stress & HTTP Load Testing Suite** built for testing servers, PCs, and Android devices (including rooted NetHunter and Termux environments).

Designed to push your hardware and target servers to **100% full capacity** across all CPU cores, physical RAM, and network bandwidth!

---

## 🌟 Key Features

### 1. 🔥 100% Multi-Core CPU Burner
- Spawns independent **Node.js Worker Threads** across all CPU cores (e.g. 8 cores on octa-core devices).
- Runs parallel cryptographic hashing cycles (`SHA-512`) alongside HTTP generation to drive all CPU cores to **100% saturation**.

### 2. 🧠 Physical RAM Stress Allocator
- Allocates real raw buffers outside the V8 heap in 512MB kernel pages (up to **10 GB+**).
- Push device memory utilization up to **90%–95%** on demand to test OOM resilience and thermal limits.

### 3. 🎯 5 Advanced Load Test Profiles
- **🎯 Constant Load:** Fixed steady RPS for baseline performance and SLA verification.
- **📈 Ramp-Up (Stepped):** Automatically steps up traffic (e.g. 50 → 250 → 500 → 1,000 → 2,500 RPS) to identify exact breaking points.
- **⚡ Spike Surge:** Alternates between low baseline and sudden violent traffic surges to test autoscaling and buffer recovery.
- **🌊 Sinusoidal Wave:** Oscillates throughput continuously in a wave pattern simulating real-world traffic peaks and valleys.
- **⏳ Soak / Endurance:** Long-duration stress testing to detect memory leaks, socket exhaustion, and connection degradation over time.

### 4. 🌐 Real-Time Network Telemetry (Upload & Download)
- Live Download Speed (`KB/s` / `MB/s`) and Total Downloaded Volume.
- Live Upload Speed (`KB/s` / `MB/s`) and Total Uploaded Volume.
- Dynamic Upload Payload generator (1 KB to 100 KB per request).
- HTTP Methods support: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, and `MIXED`.

### 5. ⏱️ Microsecond Latency Distribution
- Tracks **Min, Max, Avg, p50, p75, p90, p95, p99, and p99.9** percentiles in real time.
- Status code breakdown: `2xx OK`, `3xx Redirects`, `4xx Client Errors`, `5xx Server Errors`, and network timeouts.

### 6. 📊 Cyberpunk Live Web Dashboard
- Beautiful dark cyberpunk dashboard on **`http://localhost:4000`** with real-time Chart.js graphs.
- Live dynamic sliders: adjust RPS, concurrency, cores, and RAM on the fly without stopping the test!
- **One-Click JSON Benchmark Export** for archival and reporting.

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone git@github.com:HackerJaatWorld/Test-your-pc-.git
cd Test-your-pc-
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start the Dashboard
```bash
npm run dashboard
```

Open your browser at:
👉 **`http://localhost:4000`**

---

## ⚙️ Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dashboard` | Starts the multi-core interactive Web Dashboard on port `4000` |
| `npm run load-test` | Runs an automated batch load test using Artillery |
| `npm start` | Alias for `npm run dashboard` |

---

## 🎛️ Dashboard Controls Guide

1. **Target URL:** Enter the server you want to stress test (default: `http://localhost:3000`).
2. **Test Profile:** Choose between *Constant*, *Ramp-Up*, *Spike Surge*, *Wave*, or *Soak*.
3. **RPS Slider:** Set throughput from `10` to `3,000+` requests per second.
4. **Concurrency:** Set parallel in-flight connections from `10` to `500` workers.
5. **Active Cores:** Select how many CPU worker threads to activate (1 to 8 cores).
6. **Physical RAM:** Allocate `0 GB` to `10 GB` of raw memory buffers.
7. **Custom Headers:** Pass custom authentication tokens or JSON headers (e.g. `{"Authorization": "Bearer token"}`).
8. **Export:** Click **Export** to download the full test benchmark report in JSON format.

---

## 📡 REST API & Streaming Telemetry

The dashboard exposes real-time endpoints for programmatic integration:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/stream` | Server-Sent Events (SSE) streaming live metrics every second |
| `GET` | `/api/stats` | JSON snapshot of current throughput, latency, hardware, and network |
| `GET` | `/api/export` | Download full benchmark report JSON |
| `POST` | `/api/start` | Start load test with custom configuration payload |
| `POST` | `/api/adjust` | Adjust RPS, concurrency, RAM, or profiles live on the fly |
| `POST` | `/api/pause` | Pause the active test |
| `POST` | `/api/stop` | Stop the test and spin down workers |
| `POST` | `/api/reset` | Reset all counters and free allocated memory buffers |

---

## 🛡️ Architecture

```
                       +----------------------------------+
                       |     Web Dashboard (Port 4000)    |
                       |  Chart.js / SSE Real-Time Stream |
                       +-----------------+----------------+
                                         |
                                         v
                       +-----------------+----------------+
                       |       Master Process (Node)      |
                       |  - Metric Aggregator (1-sec tick)|
                       |  - Hardware Telemetry (CPU/RAM)  |
                       |  - RAM Buffer Allocator (10GB)   |
                       +--------+---------------+---------+
                                |               |
           +--------------------+               +--------------------+
           |                                                         |
           v                                                         v
+----------------------+                                  +----------------------+
|   Worker Thread 1    |     ... up to 8 Cores ...        |   Worker Thread 8    |
| - High-perf Agent    |                                  | - High-perf Agent    |
| - KeepAlive Pool     |                                  | - KeepAlive Pool     |
| - 100% CPU Burner    |                                  | - 100% CPU Burner    |
+----------+-----------+                                  +----------+-----------+
           |                                                         |
           +--------------------+               +--------------------+
                                v               v
                       +----------------------------------+
                       |     Target Server (Port 3000)    |
                       |   HTTP GET/POST/PUT/DELETE APIs  |
                       +----------------------------------+
```

---

## ⚠️ Thermal & Safety Notice

When running in **Full Beast Mode** (8 Cores + 100% CPU Burn + 10GB RAM Allocation):
- Mobile devices (Android NetHunter/Termux) and laptops will experience significant thermal output.
- An instant **"Stop / Cool Down"** button is built into the dashboard to terminate stress loops immediately.

---

## 👤 Author

- **GitHub:** [@HackerJaatWorld](https://github.com/HackerJaatWorld)
- **Email:** lalsinghsukhdev@gmail.com

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
