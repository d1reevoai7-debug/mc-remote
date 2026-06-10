const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

let modClient = null;
const webClients = new Set();

// Cache to instantly serve new web clients
let cache = {
  reportsEnabled: false,
  reports: [],
  history: [],
  modCount: 0
};

wss.on('connection', (ws, req) => {
  if (req.url === '/mod') {
    modClient = ws;
    console.log('[Server] Mod Client connected');
    
    ws.on('message', (message) => {
      try {
        const strMsg = message.toString();
        const data = JSON.parse(strMsg);
        
        if (data.type === 'init') {
          cache.reportsEnabled = data.reportsEnabled;
          cache.reports = data.reports || [];
          cache.history = data.history || [];
          broadcastToWeb(strMsg);
        } else if (data.type === 'new_report') {
          cache.reports.unshift(data.data);
          if (cache.reports.length > 50) cache.reports.pop();
          broadcastToWeb(strMsg);
        } else if (data.type === 'history_entry') {
          cache.history.unshift(data.data);
          if (cache.history.length > 200) cache.history.pop();
          broadcastToWeb(strMsg);
        } else if (data.type === 'toggle') {
          cache.reportsEnabled = data.enabled;
          broadcastToWeb(strMsg);
        } else if (data.type === 'stats_data') {
          broadcastToWeb(strMsg);
        } else if (data.type === 'mod_count') {
          cache.modCount = data.count;
          broadcastToWeb(strMsg);
        } else if (data.type === 'photo_proof') {
          const entry = cache.history.find(h => h.playerName === data.playerName);
          if (entry) {
             entry.proofUrl = data.url;
             broadcastToWeb(strMsg);
          }
        }
      } catch (e) {
        console.error('Error parsing mod message', e);
      }
    });
    
    ws.on('close', () => {
      console.log('[Server] Mod Client disconnected');
      if (modClient === ws) modClient = null;
      broadcastToWeb(JSON.stringify({ type: 'status', status: 'disconnected' }));
    });
    
    broadcastToWeb(JSON.stringify({ type: 'status', status: 'connected' }));
  } 
  else if (req.url === '/web') {
    webClients.add(ws);
    console.log(`[Server] Web Client connected. Total: ${webClients.size}`);
    
    // 1. Send initial state
    ws.send(JSON.stringify({
      type: 'init',
      reportsEnabled: cache.reportsEnabled,
      reports: cache.reports,
      history: cache.history
    }));
    
    // 2. Send mod status
    ws.send(JSON.stringify({
      type: 'status',
      status: modClient ? 'connected' : 'disconnected'
    }));

    // 3. Send mod count if known
    if (cache.modCount > 0) {
      ws.send(JSON.stringify({
        type: 'mod_count',
        count: cache.modCount
      }));
    }
    
    ws.on('message', (message) => {
      const strMsg = message.toString();
      // Forward commands to Mod
      if (modClient && modClient.readyState === WebSocket.OPEN) {
        modClient.send(strMsg);
        // Acknowledge back to the web client
        try {
          const data = JSON.parse(strMsg);
          if (data.action === 'command' || data.action === 'react') {
             ws.send(JSON.stringify({ type: 'command_ack' }));
          }
        } catch (e) {}
      }
    });
    
    ws.on('close', () => {
      webClients.delete(ws);
      console.log(`[Server] Web Client disconnected. Total: ${webClients.size}`);
    });
  } else {
    // Reject unknown paths
    ws.close();
  }
});

function broadcastToWeb(message) {
  for (let client of webClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
