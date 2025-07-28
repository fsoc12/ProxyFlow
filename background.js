const PROXY_STORAGE_KEY = "proxyFlowData";
const DEFAULT_STATE = {
  profiles: [],
  activeProfileId: null,
  connectionStatus: "disconnected",
  lastPing: null
};
let pingInterval = null;

async function loadState() {
  try {
    const data = await chrome.storage.local.get(PROXY_STORAGE_KEY);
    return data[PROXY_STORAGE_KEY] ? {...DEFAULT_STATE, ...data[PROXY_STORAGE_KEY]} : {...DEFAULT_STATE};
  } catch (error) {
    console.error("Failed to load state:", error);
    return {...DEFAULT_STATE};
  }
}

async function saveState(state) {
  try {
    await chrome.storage.local.set({[PROXY_STORAGE_KEY]: state});
    chrome.runtime.sendMessage({type: "PROXY_DATA_UPDATED", data: state});
    return true;
  } catch (error) {
    console.error("Failed to save state:", error);
    return false;
  }
}

function startPingInterval() {
  if (pingInterval) clearInterval(pingInterval);
  
  pingInterval = setInterval(async () => {
    const state = await loadState();
    if (state.connectionStatus !== "connected") return;
    
    try {
      const testResult = await testConnection();
      if (testResult.status === "connected") {
        await saveState({...state, lastPing: testResult.ping});
      }
    } catch (error) {
      console.log("Ping error:", error);
    }
  }, 30000);
}

async function initializeProxy() {
  const state = await loadState();
  if (state.activeProfileId) {
    const profile = state.profiles.find(p => p.id === state.activeProfileId);
    if (profile) {
      try {
        await applyProxy(profile);
        const testResult = await testConnection();
        await saveState({
          ...state,
          connectionStatus: testResult.status === "connected" ? "connected" : "error",
          lastPing: testResult.ping
        });
      } catch (error) {
        console.error("Failed to apply proxy:", error);
        await saveState({...state, activeProfileId: null, connectionStatus: "disconnected"});
      }
    }
  }
  startPingInterval();
}

async function applyProxy(config) {
  return new Promise((resolve, reject) => {
    const port = parseInt(config.port);
    if (isNaN(port) || port <= 0 || port > 65535) {
      reject(new Error("Invalid port number"));
      return;
    }

    let proxyHost = config.host;
    if (config.username && config.password) {
      proxyHost = `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${proxyHost}`;
    }

    chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: "http",
            host: proxyHost,
            port: port
          },
          bypassList: ["<local>"]
        }
      },
      scope: "regular"
    }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

async function testConnection() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const start = Date.now();
    const response = await fetch("https://www.gstatic.com/generate_204", {
      method: "HEAD",
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    return {status: "connected", ping: Date.now() - start};
  } catch (error) {
    return {status: "error", error: error.message};
  }
}

async function handleProxyToggle(profileId) {
  const state = await loadState();
  
  if (state.activeProfileId === profileId) {
    try {
      await chrome.proxy.settings.clear({scope: "regular"});
    } catch (error) {
      console.error("Failed to clear proxy settings:", error);
      return {error: "Failed to disconnect proxy"};
    }
    
    const newState = {
      ...state,
      activeProfileId: null,
      connectionStatus: "disconnected",
      lastPing: null
    };
    await saveState(newState);
    return {status: "disabled"};
  } 
  else {
    const profile = state.profiles.find(p => p.id === profileId);
    if (!profile) return {error: "Profile not found"};
    
    try {
      await applyProxy(profile);
    } catch (error) {
      console.error("Proxy activation error:", error);
      return {error: "Failed to connect. Check proxy settings."};
    }
    
    const newState = {
      ...state,
      activeProfileId: profileId,
      connectionStatus: "connecting"
    };
    await saveState(newState);
    
    // Test connection after short delay
    setTimeout(async () => {
      try {
        const testResult = await testConnection();
        const updatedState = await loadState();
        await saveState({
          ...updatedState,
          connectionStatus: testResult.status === "connected" ? "connected" : "error",
          lastPing: testResult.ping
        });
      } catch (error) {
        console.error("Connection test failed:", error);
      }
    }, 1500);
    
    return {status: "enabled"};
  }
}

async function saveProfile(profile) {
  const state = await loadState();
  
  if (!profile.name || !profile.host || !profile.port) {
    return {error: "Name, host and port are required"};
  }
  
  const port = parseInt(profile.port);
  if (isNaN(port) || port <= 0 || port > 65535) {
    return {error: "Invalid port number (1-65535)"};
  }
  
  const existingIndex = state.profiles.findIndex(p => p.id === profile.id);
  const newProfile = {...profile, port: port.toString()};
  
  if (existingIndex !== -1) {
    state.profiles[existingIndex] = newProfile;
    
    // Update active profile if edited
    if (state.activeProfileId === profile.id) {
      try {
        await applyProxy(newProfile);
      } catch (error) {
        console.error("Failed to update active profile:", error);
      }
    }
  } else {
    newProfile.id = Date.now().toString();
    state.profiles.push(newProfile);
  }
  
  await saveState(state);
  return {success: true, profileId: newProfile.id};
}

async function deleteProfile(profileId) {
  const state = await loadState();
  
  if (state.activeProfileId === profileId) {
    try {
      await chrome.proxy.settings.clear({scope: "regular"});
    } catch (error) {
      console.error("Failed to clear proxy settings:", error);
    }
  }
  
  const newState = {
    profiles: state.profiles.filter(p => p.id !== profileId),
    activeProfileId: state.activeProfileId === profileId ? null : state.activeProfileId,
    connectionStatus: state.activeProfileId === profileId ? "disconnected" : state.connectionStatus,
    lastPing: state.activeProfileId === profileId ? null : state.lastPing
  };
  
  await saveState(newState);
  return {success: true};
}

// Initialize
chrome.runtime.onInstalled.addListener(initializeProxy);
chrome.runtime.onStartup.addListener(initializeProxy);
startPingInterval();

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    "TOGGLE_PROXY": () => handleProxyToggle(msg.profileId).then(sendResponse),
    "SAVE_PROFILE": () => saveProfile(msg.profile).then(sendResponse),
    "DELETE_PROFILE": () => deleteProfile(msg.profileId).then(sendResponse),
    "TEST_CONNECTION": () => testConnection().then(sendResponse),
    "GET_PROXY_DATA": () => loadState().then(sendResponse)
  };

  if (handlers[msg.type]) {
    handlers[msg.type]();
    return true;
  }
});