#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';

function parseArgs(argv) {
  const parsed = {
    message: 'Reply with the single word ACK.',
    timeoutSec: 45,
    intervalMs: 2000,
    instanceId: null,
    sessionId: null,
    happyHome: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--message' && argv[i + 1]) {
      parsed.message = argv[++i];
      continue;
    }
    if (arg === '--timeout' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) parsed.timeoutSec = n;
      continue;
    }
    if (arg === '--interval' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) parsed.intervalMs = n;
      continue;
    }
    if (arg === '--instance' && argv[i + 1]) {
      parsed.instanceId = argv[++i];
      continue;
    }
    if (arg === '--session' && argv[i + 1]) {
      parsed.sessionId = argv[++i];
      continue;
    }
    if (arg === '--happy-home' && argv[i + 1]) {
      parsed.happyHome = argv[++i];
      continue;
    }
  }

  return parsed;
}

function resolveHappyHome(cliHome) {
  if (cliHome && cliHome.trim().length > 0) {
    return cliHome.startsWith('~')
      ? path.join(os.homedir(), cliHome.slice(1))
      : cliHome;
  }

  if (process.env.HAPPY_HOME_DIR && process.env.HAPPY_HOME_DIR.trim().length > 0) {
    const envHome = process.env.HAPPY_HOME_DIR;
    return envHome.startsWith('~')
      ? path.join(os.homedir(), envHome.slice(1))
      : envHome;
  }

  const devHome = path.join(os.homedir(), '.happy-dev');
  if (fs.existsSync(path.join(devHome, 'daemon.state.json'))) {
    return devHome;
  }

  return path.join(os.homedir(), '.happy');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function asString(value) {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value) {
  return typeof value === 'number' ? value : undefined;
}

function asPath(value) {
  if (!Array.isArray(value)) return undefined;
  const pathSegments = [];
  for (const segment of value) {
    if (typeof segment === 'string' || typeof segment === 'number') {
      pathSegments.push(segment);
      continue;
    }
    return undefined;
  }
  return pathSegments;
}

function setPathValue(rootValue, objectPath, nextValue) {
  if (!Array.isArray(objectPath) || objectPath.length === 0) {
    return nextValue;
  }

  let root = rootValue;
  if (!root || typeof root !== 'object') {
    root = typeof objectPath[0] === 'number' ? [] : {};
  }

  let current = root;
  for (let i = 0; i < objectPath.length - 1; i++) {
    const key = objectPath[i];
    const existing = current[key];
    if (!existing || typeof existing !== 'object') {
      const nextKey = objectPath[i + 1];
      current[key] = typeof nextKey === 'number' ? [] : {};
    }
    current = current[key];
  }

  current[objectPath[objectPath.length - 1]] = nextValue;
  return root;
}

function pushPathValues(rootValue, objectPath, values, startIndex) {
  if (!Array.isArray(objectPath) || objectPath.length === 0) {
    return rootValue;
  }

  let root = rootValue;
  if (!root || typeof root !== 'object') {
    root = typeof objectPath[0] === 'number' ? [] : {};
  }

  let current = root;
  for (let i = 0; i < objectPath.length - 1; i++) {
    const key = objectPath[i];
    const existing = current[key];
    if (!existing || typeof existing !== 'object') {
      const nextKey = objectPath[i + 1];
      current[key] = typeof nextKey === 'number' ? [] : {};
    }
    current = current[key];
  }

  const arrayKey = objectPath[objectPath.length - 1];
  const existingArray = current[arrayKey];
  const targetArray = Array.isArray(existingArray) ? existingArray : [];
  if (typeof startIndex === 'number' && Number.isFinite(startIndex) && startIndex >= 0) {
    targetArray.length = startIndex;
  }
  if (Array.isArray(values) && values.length > 0) {
    targetArray.push(...values);
  }
  current[arrayKey] = targetArray;
  return root;
}

function readJsonMutationLog(filePath) {
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return undefined;
  }

  let state;
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const record = asRecord(parsed);
    if (!record) continue;
    const kind = asNumber(record.kind);
    const objectPath = asPath(record.k);

    if (kind === 0) {
      state = record.v;
    } else if (kind === 1 && objectPath) {
      state = setPathValue(state, objectPath, record.v);
    } else if (kind === 2 && objectPath) {
      const values = Array.isArray(record.v) ? record.v : undefined;
      const startIndex = asNumber(record.i);
      state = pushPathValues(state, objectPath, values, startIndex);
    } else if (kind === 3 && objectPath) {
      state = setPathValue(state, objectPath, undefined);
    }
  }

  return state;
}

function readSessionJson(filePath) {
  if (filePath.endsWith('.jsonl')) {
    const parsed = readJsonMutationLog(filePath);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Invalid JSONL session data: ${filePath}`);
    }
    return parsed;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractUserText(request) {
  const message = asRecord(request?.message ?? request);
  if (!message) return '';

  const direct = asString(message.text);
  if (direct && direct.trim().length > 0) return direct.trim();

  const parts = Array.isArray(message.parts) ? message.parts : [];
  const chunks = [];
  for (const part of parts) {
    const p = asRecord(part);
    const text = p ? asString(p.text) : undefined;
    if (text && text.trim().length > 0) {
      chunks.push(text.trim());
    }
  }
  return chunks.join('\n').trim();
}

function extractAssistantText(request) {
  const response = Array.isArray(request?.response) ? request.response : [];
  const chunks = [];
  for (const entry of response) {
    const e = asRecord(entry);
    if (!e) continue;
    const text = asString(e.value) ?? asString(e.text) ?? asString(e.content) ?? asString(e.markdown);
    if (text && text.trim().length > 0) {
      chunks.push(text.trim());
    }
  }
  return chunks.join('\n').trim();
}

function normalizeMessages(rawMessages, sessionId) {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  return rawMessages
    .map((message, index) => {
      const value = asRecord(message);
      if (!value) {
        return null;
      }
      const role = value.role === 'assistant' ? 'assistant' : value.role === 'user' ? 'user' : null;
      const text = asString(value.text) ?? '';
      const timestamp = asNumber(value.timestamp) ?? Date.now() + index;
      if (!role) {
        return null;
      }
      return {
        id: asString(value.id) ?? `${sessionId}:history:${role}:${index}`,
        role,
        text,
        timestamp
      };
    })
    .filter((entry) => entry !== null);
}

function loadSessionStateFromHistoryPayload(payload, sessionId) {
  const root = asRecord(payload);
  const history = asRecord(root?.history) ?? root;
  if (!history) {
    throw new Error('Unexpected history payload');
  }

  const messages = normalizeMessages(history.messages, sessionId);
  const userMessages = messages.filter((message) => message.role === 'user');
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const lastUser = userMessages[userMessages.length - 1];
  const lastAssistant = assistantMessages[assistantMessages.length - 1];

  return {
    mode: 'history',
    requestCount: userMessages.length,
    lastUserText: lastUser?.text ?? '',
    lastAssistantText: lastAssistant?.text ?? '',
    lastAssistantChunkCount: lastAssistant ? 1 : 0,
    messages
  };
}

function loadSessionStateFromFile(sessionPath) {
  const json = readSessionJson(sessionPath);
  const requestsRaw = Array.isArray(json.requests) ? json.requests : [];
  const requests = requestsRaw
    .map((value) => asRecord(value))
    .filter((value) => value !== undefined);
  const last = requests[requests.length - 1];
  return {
    mode: 'file',
    requests,
    requestCount: requests.length,
    lastUserText: extractUserText(last),
    lastAssistantText: extractAssistantText(last),
    lastAssistantChunkCount: Array.isArray(last?.response) ? last.response.length : 0,
    messages: []
  };
}

async function fetchJson(url, init = undefined) {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body = {};
  if (raw && raw.trim().length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw };
    }
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${raw}`);
  }
  return body;
}

function isRouteNotFoundError(error) {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('route') && msg.includes('not found');
}

async function loadSessionState(baseUrl, instanceId, session, limit, fallbackToFile = true) {
  const historyUrl = `${baseUrl}/vscode/instances/${encodeURIComponent(instanceId)}/sessions/${encodeURIComponent(session.id)}/history?limit=${encodeURIComponent(String(limit))}`;

  try {
    const payload = await fetchJson(historyUrl);
    return loadSessionStateFromHistoryPayload(payload, session.id);
  } catch (error) {
    if (!fallbackToFile || !session.jsonPath || !fs.existsSync(session.jsonPath) || !isRouteNotFoundError(error)) {
      throw error;
    }
  }

  return loadSessionStateFromFile(session.jsonPath);
}

function findLastMatchingUserMessageIndex(messages, expectedText) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    if (message.text.trim() === expectedText.trim()) {
      return i;
    }
  }
  return -1;
}

async function main() {
  const args = parseArgs(process.argv);
  const happyHome = resolveHappyHome(args.happyHome);
  const daemonStatePath = path.join(happyHome, 'daemon.state.json');

  if (!fs.existsSync(daemonStatePath)) {
    throw new Error(`Daemon state not found: ${daemonStatePath}`);
  }

  const daemonState = readJson(daemonStatePath);
  const port = Number(daemonState.httpPort);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid daemon httpPort in ${daemonStatePath}`);
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[smoke] daemon=${baseUrl} happyHome=${happyHome}`);

  const instancesPayload = await fetchJson(`${baseUrl}/vscode/instances`);
  const instances = Array.isArray(instancesPayload.instances) ? instancesPayload.instances : [];
  if (instances.length === 0) {
    throw new Error('No VS Code bridge instances are connected.');
  }

  const sortedInstances = [...instances].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const instance = args.instanceId
    ? sortedInstances.find((x) => x.instanceId === args.instanceId)
    : sortedInstances[0];
  if (!instance) {
    throw new Error(`Instance not found: ${args.instanceId}`);
  }

  const sessionsPayload = await fetchJson(`${baseUrl}/vscode/instances/${instance.instanceId}/sessions`);
  const sessions = Array.isArray(sessionsPayload.sessions) ? sessionsPayload.sessions : [];
  if (sessions.length === 0) {
    throw new Error(`No sessions for instance ${instance.instanceId}`);
  }

  const sortedSessions = [...sessions].sort((a, b) => (b.lastMessageDate ?? 0) - (a.lastMessageDate ?? 0));
  const session = args.sessionId
    ? sortedSessions.find((x) => x.id === args.sessionId)
    : sortedSessions[0];
  if (!session) {
    throw new Error(`Session not found: ${args.sessionId}`);
  }

  const smokeTag = `[happy-smoke:${Date.now().toString(36)}]`;
  const messageToSend = `${args.message} ${smokeTag}`.trim();

  const before = await loadSessionState(baseUrl, instance.instanceId, session, 250);
  console.log(`[smoke] instance=${instance.instanceId} app=${instance.appName}`);
  console.log(`[smoke] session=${session.id} title=${session.title}`);
  console.log(`[smoke] mode=${before.mode} before requests=${before.requestCount} lastUser="${before.lastUserText.slice(0, 80)}"`);
  console.log(`[smoke] sending: "${messageToSend}"`);

  const sendPayload = await fetchJson(`${baseUrl}/vscode/instances/${instance.instanceId}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id,
      message: messageToSend,
    }),
  });

  console.log(`[smoke] queued commandId=${sendPayload.commandId}`);

  const deadline = Date.now() + args.timeoutSec * 1000;
  let observedRequest = false;
  while (Date.now() < deadline) {
    const current = await loadSessionState(baseUrl, instance.instanceId, session, 250);
    let sawUserMessage = false;
    let hasAssistantResponse = false;

    if (current.mode === 'history') {
      const userIdx = findLastMatchingUserMessageIndex(current.messages, messageToSend);
      sawUserMessage = userIdx >= 0;
      if (sawUserMessage) {
        hasAssistantResponse = current.messages.slice(userIdx + 1).some((message) => (
          message.role === 'assistant' && message.text.trim().length > 0
        ));
      }
    } else {
      const requestIncreased = current.requestCount > before.requestCount;
      const lastUserMatches = current.lastUserText.trim() === messageToSend.trim();
      sawUserMessage = requestIncreased && lastUserMatches;
      hasAssistantResponse = current.lastAssistantChunkCount > 0;
    }

    console.log(
      `[smoke] mode=${current.mode} requests=${current.requestCount} lastUser="${current.lastUserText.slice(0, 60)}" responseChunks=${current.lastAssistantChunkCount}`
    );

    if (sawUserMessage) {
      observedRequest = true;
    }

    if (sawUserMessage && hasAssistantResponse) {
      console.log('[smoke] PASS: request and assistant response observed.');
      console.log(`[smoke] assistant="${current.lastAssistantText.slice(0, 120)}"`);
      process.exit(0);
    }

    await sleep(args.intervalMs);
  }

  if (!observedRequest) {
    console.error('[smoke] FAIL: queued command but no matching user request was observed in history.');
  } else {
    console.error('[smoke] FAIL: user request appeared but assistant response did not arrive before timeout.');
  }
  process.exit(1);
}

main().catch((error) => {
  console.error(`[smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
