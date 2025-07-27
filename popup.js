const elements = {
  profilesList: document.getElementById('profilesList'),
  statusIndicator: document.getElementById('connectionStatus'),
  statusDot: document.querySelector('.status-dot'),
  statusText: document.querySelector('.status-text'),
  pingValue: document.querySelector('.ping-value'),
  newProfileBtn: document.getElementById('newProfileBtn'),
  editBtn: document.getElementById('editBtn'),
  globalToggleBtn: document.getElementById('globalToggleBtn')
};

let currentState = null;
let selectedProfileId = null;
let isClosing = false;

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
  await loadProxyData();
  setupEventListeners();
});

// Загрузка данных
async function loadProxyData() {
  try {
    currentState = await new Promise(resolve => {
      chrome.runtime.sendMessage(
        {type: "GET_PROXY_DATA"}, 
        resolve
      );
    });
    
    renderProfiles();
    updateConnectionStatus();
    updateActionButtons();
  } catch (error) {
    console.error("Failed to load proxy data:", error);
  }
}

// Настройка обработчиков событий
function setupEventListeners() {
  // Новая конфигурация
  elements.newProfileBtn.addEventListener('click', () => {
    window.location.href = 'edit.html';
  });
  
  // Редактирование
  elements.editBtn.addEventListener('click', () => {
    if (!selectedProfileId) return;
    window.location.href = `edit.html?profileId=${selectedProfileId}`;
  });
  
  // Глобальное переключение прокси
  elements.globalToggleBtn.addEventListener('click', toggleProxy);
  
  // Обновление данных при изменении
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === "PROXY_DATA_UPDATED") {
      currentState = msg.data;
      renderProfiles();
      updateConnectionStatus();
      updateActionButtons();
    }
  });
  
  // Анимация закрытия
  window.addEventListener('beforeunload', () => {
    if (!isClosing) {
      document.body.style.opacity = '0';
      isClosing = true;
    }
  });
}

// Обновление статуса соединения
function updateConnectionStatus() {
  if (!currentState) return;
  
  const status = currentState.connectionStatus || 'disconnected';
  
  // Плавное изменение статуса
  elements.statusDot.style.animation = 'none';
  setTimeout(() => {
    elements.statusDot.className = 'status-dot';
    elements.statusDot.classList.add(`status-${status}`);
  }, 10);
  
  elements.statusText.textContent = 
    status === 'connected' ? 'Connected' :
    status === 'connecting' ? 'Connecting...' :
    status === 'error' ? 'Connection failed' : 'Disconnected';
  
  elements.pingValue.textContent = currentState.lastPing 
    ? `${currentState.lastPing} ms` 
    : '- ms';
}

// Обновление кнопок действий
function updateActionButtons() {
  // Обновление глобальной кнопки
  if (currentState.activeProfileId) {
    elements.globalToggleBtn.textContent = 'Disconnect';
    elements.globalToggleBtn.className = 'btn btn-danger';
  } else {
    elements.globalToggleBtn.textContent = 'Connect';
    elements.globalToggleBtn.className = 'btn btn-primary';
  }
  
  // Показываем кнопку Edit только если выбран профиль
  if (selectedProfileId) {
    elements.editBtn.classList.remove('hidden');
  } else {
    elements.editBtn.classList.add('hidden');
  }
}

// Отображение профилей
function renderProfiles() {
  if (!currentState || !currentState.profiles) return;
  
  // Очищаем список только если нет профилей
  if (currentState.profiles.length === 0) {
    elements.profilesList.innerHTML = '<div class="empty-state">No profiles saved yet</div>';
    return;
  }
  
  // Создаем фрагмент для оптимизации рендеринга
  const fragment = document.createDocumentFragment();
  
  elements.profilesList.innerHTML = '';
  
  currentState.profiles.forEach(profile => {
    const profileEl = document.createElement('div');
    profileEl.className = 'profile-item';
    profileEl.dataset.id = profile.id;
    
    // Выделяем активный профиль
    if (currentState.activeProfileId === profile.id) {
      profileEl.classList.add('active');
    }
    
    // Выделяем выбранный профиль
    if (selectedProfileId === profile.id) {
      profileEl.classList.add('selected');
    }
    
    profileEl.innerHTML = `
      <div class="profile-name">
        ${profile.name}
        ${currentState.activeProfileId === profile.id ? 
          '<span class="active-indicator"></span>' : ''}
      </div>
      <div class="profile-details">
        ${profile.host}:${profile.port} 
        ${profile.username ? `(${profile.username})` : ''}
      </div>
    `;
    
    profileEl.addEventListener('click', () => {
      // Снимаем выделение со всех
      document.querySelectorAll('.profile-item').forEach(el => {
        el.classList.remove('selected');
      });
      
      // Выделяем текущий
      profileEl.classList.add('selected');
      
      // Устанавливаем выбранный профиль
      selectedProfileId = profile.id;
      updateActionButtons();
    });
    
    fragment.appendChild(profileEl);
  });
  
  elements.profilesList.appendChild(fragment);
}

// Переключение прокси
async function toggleProxy() {
  try {
    // Определяем профиль для переключения
    let targetProfileId = currentState.activeProfileId;
    
    // Если нет активного профиля, используем выбранный
    if (!targetProfileId && selectedProfileId) {
      targetProfileId = selectedProfileId;
    }
    
    if (!targetProfileId) {
      alert("Please select a profile first");
      return;
    }
    
    setButtonState(elements.globalToggleBtn, 
      currentState.activeProfileId ? 'Disconnecting...' : 'Connecting...', 
      true
    );
    
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage(
        {type: "TOGGLE_PROXY", profileId: targetProfileId}, 
        resolve
      );
    });
    
    if (result.error) {
      alert(`Error: ${result.error}`);
      return;
    }
    
    // Обновляем состояние на основе результата
    if (result.status === "enabled") {
      currentState.activeProfileId = targetProfileId;
      currentState.connectionStatus = "connecting";
      
      // Автоматически выбираем подключенный профиль
      selectedProfileId = targetProfileId;
    } else if (result.status === "disabled") {
      currentState.activeProfileId = null;
      currentState.connectionStatus = "disconnected";
      currentState.lastPing = null;
    }
    
    // Обновление интерфейса
    updateConnectionStatus();
    updateActionButtons();
    renderProfiles();
    
    // Автоматическое тестирование соединения
    if (result.status === "enabled") {
      setTimeout(async () => {
        const testResult = await new Promise(resolve => {
          chrome.runtime.sendMessage({type: "TEST_CONNECTION"}, resolve);
        });
        
        if (testResult.status === "connected") {
          currentState.connectionStatus = "connected";
          currentState.lastPing = testResult.ping;
        } else {
          currentState.connectionStatus = "error";
        }
        
        updateConnectionStatus();
      }, 1500);
    }
  } catch (error) {
    console.error("Failed to toggle proxy:", error);
    alert("Failed to toggle proxy. Please try again.");
  } finally {
    setButtonState(elements.globalToggleBtn, 
      currentState.activeProfileId ? 'Disconnect' : 'Connect', 
      false
    );
  }
}

// Управление состоянием кнопок
function setButtonState(button, text, isLoading) {
  if (text) {
    button.textContent = text;
  }
  
  if (isLoading) {
    button.classList.add('loading');
    button.disabled = true;
  } else {
    button.classList.remove('loading');
    button.disabled = false;
  }
}