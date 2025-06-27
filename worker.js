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
            
            stats.total++;
            if (level === 'ERROR') { stats.errors++; errorCounter++; }
            else if (level === 'WARN') { stats.warnings++; }
            
            currentLog = {
                index: allLogs.length,
                timestamp,
                level,
                message: message.trim(),
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

            const counts = messageCounts[level];
            const msgKey = currentLog.message;
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

    postMessage({ logs: allLogs, stats, topErrors, topWarnings, topInfos });
  } catch (err) {
    postMessage({ error: err.message });
  }
};