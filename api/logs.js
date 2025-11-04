module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
  // Format logs to ensure consistent structure
  const logs = (global.webhookLogs || []).map(log => ({
    id: log.id || Date.now(),
    type: log.type || 'info',
    message: log.message || 'No message',
    details: log.details || null,
    timestamp: log.timestamp || new Date().toISOString(),
    time: log.time || new Date().toLocaleTimeString()
  }));

  return res.status(200).json({
    logs: logs,
    count: logs.length,
    timestamp: new Date().toISOString()
  });
  };