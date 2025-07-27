const PROXY_STORAGE_KEY = "proxyFlowData";
const DEFAULT_STATE = {
  profiles: [],
  activeProfileId: null,
  connectionStatus: "disconnected",
  lastPing: null
};

// Улучшенная загрузка состояния
async function loadState() {
  try {
    const data = await chrome.storage.local.get(PROXY_STORAGE_KEY);
    return data[PROXY_STORAGE_KEY] ? {...DEFAULT_STATE, ...data[PROXY_STORAGE_KEY]} : {...DEFAULT_STATE};
  } catch (error) {
    console.error("Failed to load state:", error);
    return {...DEFAULT_STATE};
  }
}

// Оптимизированное сохранение состояния
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

// Инициализация
chrome.runtime.onInstalled.addListener(async () => {
  const state = await loadState();
  await saveState(state);
  
  if (state.activeProfileId) {
    const profile = state.profiles.find(p => p.id === state.activeProfileId);
    if (profile) {
      try {
        await applyProxy(profile);
      } catch (error) {
        console.error("Failed to apply proxy on install:", error);
      }
    }
  }
});

// Восстановление при запуске
chrome.runtime.onStartup.addListener(async () => {
  const state = await loadState();
  if (state.activeProfileId) {
    const profile = state.profiles.find(p => p.id === state.activeProfileId);
    if (profile) {
      try {
        await applyProxy(profile);
      } catch (error) {
        console.error("Failed to apply proxy on startup:", error);
      }
    }
  }
});

// Обработчик сообщений
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

// Основные функции
async function handleProxyToggle(profileId) {
  const state = await loadState();
  
  // Отключение прокси
  if (state.activeProfileId === profileId) {
    try {
      await chrome.proxy.settings.clear({scope: "regular"});
    } catch (error) {
      console.error("Failed to clear proxy settings:", error);
      return {error: "Failed to disconnect proxy"};
    }
    
    state.activeProfileId = null;
    state.connectionStatus = "disconnected";
    state.lastPing = null;
    await saveState(state);
    return {status: "disabled"};
  } 
  // Включение прокси
  else {
    const profile = state.profiles.find(p => p.id === profileId);
    if (!profile) return {error: "Profile not found"};
    
    try {
      await applyProxy(profile);
    } catch (error) {
      console.error("Proxy activation error:", error);
      return {error: "Failed to connect. Check proxy settings."};
    }
    
    state.activeProfileId = profileId;
    state.connectionStatus = "connecting";
    await saveState(state);
    
    return {status: "enabled"};
  }
}

async function saveProfile(profile) {
  const state = await loadState();
  
  // Валидация данных
  if (!profile.name || !profile.host || !profile.port) {
    return {error: "Name, host and port are required"};
  }
  
  // Проверка порта
  const port = parseInt(profile.port);
  if (isNaN(port) || port <= 0 || port > 65535) {
    return {error: "Invalid port number (1-65535)"};
  }
  
  // Обновление существующего профиля
  const index = state.profiles.findIndex(p => p.id === profile.id);
  if (index !== -1) {
    state.profiles[index] = profile;
  } 
  // Создание нового профиля
  else {
    profile.id = Date.now().toString();
    state.profiles.push(profile);
  }
  
  await saveState(state);
  return {success: true, profileId: profile.id};
}

async function deleteProfile(profileId) {
  const state = await loadState();
  
  // Отключение если удаляется активный профиль
  if (state.activeProfileId === profileId) {
    try {
      await chrome.proxy.settings.clear({scope: "regular"});
    } catch (error) {
      console.error("Failed to clear proxy settings:", error);
    }
    
    state.activeProfileId = null;
    state.connectionStatus = "disconnected";
    state.lastPing = null;
  }
  
  state.profiles = state.profiles.filter(p => p.id !== profileId);
  await saveState(state);
  return {success: true};
}

function applyProxy(config) {
  return new Promise((resolve, reject) => {
    const {host, port, username, password} = config;
    
    // Кодирование учетных данных
    const proxyHost = username && password 
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}` 
      : host;

    chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: "http",
            host: proxyHost,
            port: parseInt(port)
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