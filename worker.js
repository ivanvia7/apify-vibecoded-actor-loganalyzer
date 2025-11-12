function normalizeMessage(message) {
  if (!message) return '(no message)';
  let normalized = message.trim();

  const patterns = [
    /\s*\{[\s\S]*?\}\s*$/, // trailing JSON blobs
    /\s*\((?:id|requestId|reqId|runId|datasetId|sessionId|state|details?|detail|key|value)[^)]*\)\s*$/i,
    /\s+(?:id|requestId|reqId|runId|datasetId|sessionId|state|details?|detail|key|value)\s*[:=]\s*[^\s]+\s*$/i,
    /\s+\b[A-Fa-f0-9]{12,}\b\s*$/ // long hex / GUID-like tokens
  ];

  let prev = null;
  while (prev !== normalized) {
    prev = normalized;
    patterns.forEach(pattern => {
      normalized = normalized.replace(pattern, '').trim();
    });
  }

  normalized = normalized.replace(/\s+/g, ' ');
  return normalized || '(no message)';
}

onmessage = function(e) {
  try {
    const logText = e.data;
    const allLogs = [];
    let currentLog = null;
    
    const stats = { total: 0, errors: 0, warnings: 0 };
    const messageCounts = { ERROR: {}, WARN: {}, INFO: {} };
    let errorCounter = 0;
    const lines = logText.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+(INFO|WARN|ERROR)\s+(.*)/);
        if (match) {
            if (currentLog) allLogs.push(currentLog);
            
            const [, timestamp, level, message] = match;
            const timestampMs = Date.parse(timestamp) || null;
            
            stats.total++;
            if (level === 'ERROR') { stats.errors++; errorCounter++; }
            else if (level === 'WARN') { stats.warnings++; }
            
            currentLog = {
                index: allLogs.length,
                timestamp,
                timestampMs,
                level,
                message: message.trim(),
                normalizedMessage: '',
                url: '',
                errorCount: level === 'ERROR' ? errorCounter : null
            };
            
            try {
                const jsonMatch = message.match(/(\{.*\})$/);
                if (jsonMatch && jsonMatch[1]) {
                    const data = JSON.parse(jsonMatch[1]);
                    currentLog.url = (typeof data.url === 'object' ? data.url.url : data.url) || '';
                    currentLog.message = currentLog.message.replace(jsonMatch[1], '').trim();
                } else {
                    const urlMatch = message.match(/https?:\/\/[^\s,)]+/);
                    if (urlMatch) currentLog.url = urlMatch[0];
                }
            } catch (err) { /* ignore malformed json */ }

            currentLog.normalizedMessage = normalizeMessage(currentLog.message);

            const counts = messageCounts[level];
            const msgKey = currentLog.normalizedMessage;
            counts[msgKey] = (counts[msgKey] || 0) + 1;

        } else if (currentLog && line.trim().startsWith('{')) {
            try {
                const data = JSON.parse(line.trim());
                currentLog.url = data.url || currentLog.url || '';
            } catch (err) { /* ignore */ }
        }
    }
    if (currentLog) allLogs.push(currentLog);

    const topN = 5;
    const getTopItems = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, topN);

    const topErrors = getTopItems(messageCounts.ERROR);
    const topWarnings = getTopItems(messageCounts.WARN);
    const topInfos = getTopItems(messageCounts.INFO);

    const durationEntries = [];
    const durationGroups = {};
    for (let i = 0; i < allLogs.length - 1; i++) {
        const current = allLogs[i];
        const next = allLogs[i + 1];
        if (!current.timestampMs || !next.timestampMs) continue;
        const durationMs = next.timestampMs - current.timestampMs;
        if (durationMs <= 0) continue;
        const entry = {
            startIndex: current.index,
            endIndex: next.index,
            startTime: current.timestamp,
            endTime: next.timestamp,
            durationMs,
            message: current.normalizedMessage,
            nextMessage: next.message,
            level: current.level
        };
        durationEntries.push(entry);

        const key = current.normalizedMessage || '(no message)';
        if (!durationGroups[key]) {
            durationGroups[key] = {
                message: key,
                totalMs: 0,
                count: 0,
                maxMs: 0,
                sampleStart: current.timestamp
            };
        }
        const group = durationGroups[key];
        group.totalMs += durationMs;
        group.count += 1;
        if (durationMs > group.maxMs) {
            group.maxMs = durationMs;
            group.sampleStart = current.timestamp;
        }
    }
    durationEntries.sort((a, b) => b.durationMs - a.durationMs);
    const topDurations = durationEntries.slice(0, 5);
    const groupedDurations = Object.values(durationGroups).map(group => ({
        ...group,
        avgMs: group.count ? group.totalMs / group.count : 0
    })).filter(group => group.totalMs > 0).sort((a, b) => b.totalMs - a.totalMs).slice(0, 5);

    let totalDurationMs = 0;
    const firstWithTs = allLogs.find(log => log.timestampMs);
    const lastWithTs = [...allLogs].reverse().find(log => log.timestampMs);
    if (firstWithTs && lastWithTs && lastWithTs.timestampMs >= firstWithTs.timestampMs) {
        totalDurationMs = lastWithTs.timestampMs - firstWithTs.timestampMs;
    }

    postMessage({ logs: allLogs, stats, topErrors, topWarnings, topInfos, topDurations: groupedDurations, totalDurationMs });
  } catch (err) {
    postMessage({ error: err.message });
  }
};
