const elements = {
  profilesList: document.getElementById('profilesList'),
  statusIndicator: document.getElementById('connectionStatus'),
  statusDot: document.querySelector('.status-dot'),
  statusText: document.querySelector('.status-text'),
  pingValue: document.querySelector('.ping-value'),
  newProfileBtn: document.getElementById('newProfileBtn'),
  editBtn: document.getElementById('editBtn'),
  globalToggleBtn: document.getElementById('globalToggleBtn'),
  deleteBtn: document.getElementById('deleteBtn')
};

let currentState = null;
let selectedProfileId = null;
let isNavigating = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadProxyData();
  setupEventListeners();
});

async function loadProxyData() {
  try {
    currentState = await new Promise(resolve => {
      chrome.runtime.sendMessage(
        {type: "GET_PROXY_DATA"}, 
        resolve
      );
    });
    
    // Auto-select if only one profile exists
    if (currentState.profiles.length === 1) {
      selectedProfileId = currentState.profiles[0].id;
    }
    
    renderProfiles();
    updateConnectionStatus();
    updateActionButtons();
  } catch (error) {
    console.error("Failed to load proxy data:", error);
  }
}

function setupEventListeners() {
  elements.newProfileBtn.addEventListener('click', () => navigate('edit.html'));
  elements.editBtn.addEventListener('click', () => {
    if (!selectedProfileId) return;
    navigate(`edit.html?profileId=${selectedProfileId}`);
  });
  elements.globalToggleBtn.addEventListener('click', toggleProxy);
  elements.deleteBtn.addEventListener('click', deleteSelectedProfile);
  
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === "PROXY_DATA_UPDATED") {
      currentState = msg.data;
      
      // Auto-select if only one profile exists
      if (currentState.profiles.length === 1) {
        selectedProfileId = currentState.profiles[0].id;
      } else if (currentState.profiles.length === 0) {
        selectedProfileId = null;
      }
      
      renderProfiles();
      updateConnectionStatus();
      updateActionButtons();
    }
  });
  
  window.addEventListener('beforeunload', () => {
    if (!isNavigating) {
      document.body.style.opacity = '0';
    }
  });
}

function updateConnectionStatus() {
  if (!currentState) return;
  
  const status = currentState.connectionStatus || 'disconnected';
  
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

function updateActionButtons() {
  if (currentState.activeProfileId) {
    elements.globalToggleBtn.textContent = 'Disconnect';
    elements.globalToggleBtn.className = 'btn btn-danger';
  } else {
    elements.globalToggleBtn.textContent = 'Connect';
    elements.globalToggleBtn.className = 'btn btn-primary';
  }
  
  const hasSelection = !!selectedProfileId;
  elements.editBtn.classList.toggle('hidden', !hasSelection);
  elements.deleteBtn.classList.toggle('hidden', !hasSelection);
}

function renderProfiles() {
  if (!currentState || !currentState.profiles) return;
  
  if (currentState.profiles.length === 0) {
    elements.profilesList.innerHTML = '<div class="empty-state">No profiles saved yet</div>';
    return;
  }
  
  const fragment = document.createDocumentFragment();
  elements.profilesList.innerHTML = '';
  
  currentState.profiles.forEach(profile => {
    const profileEl = document.createElement('div');
    profileEl.className = 'profile-item';
    profileEl.dataset.id = profile.id;
    
    if (currentState.activeProfileId === profile.id) {
      profileEl.classList.add('active');
    }
    
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
        ${profile.username ? ` (${profile.username})` : ''}
      </div>
    `;
    
    profileEl.addEventListener('click', () => {
      document.querySelectorAll('.profile-item').forEach(el => {
        el.classList.remove('selected');
      });
      
      profileEl.classList.add('selected');
      selectedProfileId = profile.id;
      updateActionButtons();
    });
    
    fragment.appendChild(profileEl);
  });
  
  elements.profilesList.appendChild(fragment);
}

async function toggleProxy() {
  try {
    let targetProfileId = currentState.activeProfileId;
    
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

async function deleteSelectedProfile() {
  if (!selectedProfileId) return;
  
  if (!confirm("Are you sure you want to delete this profile?")) {
    return;
  }
  
  try {
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage(
        {type: "DELETE_PROFILE", profileId: selectedProfileId}, 
        resolve
      );
    });
    
    if (result.success) {
      // Auto-select first profile if available
      if (currentState.profiles.length > 1) {
        selectedProfileId = currentState.profiles[0].id;
      } else {
        selectedProfileId = null;
      }
      
      await loadProxyData();
    } else {
      alert("Failed to delete profile");
    }
  } catch (error) {
    console.error("Failed to delete profile:", error);
    alert("Failed to delete profile");
  }
}

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

function navigate(url) {
  if (isNavigating) return;
  isNavigating = true;
  document.body.style.opacity = '0';
  setTimeout(() => {
    window.location.href = url;
  }, 300);
}