const elements = {
  backBtn: document.getElementById('backBtn'),
  saveBtn: document.getElementById('saveBtn'),
  profileName: document.getElementById('profileName'),
  host: document.getElementById('host'),
  port: document.getElementById('port'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  editTitle: document.getElementById('editTitle'),
  nameError: document.getElementById('nameError'),
  hostError: document.getElementById('hostError'),
  portError: document.getElementById('portError')
};

let profileId = null;

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
  // Получаем ID профиля из параметров URL
  const urlParams = new URLSearchParams(window.location.search);
  profileId = urlParams.get('profileId');
  
  if (profileId) {
    elements.editTitle.textContent = 'Edit Profile';
    await loadProfile();
  } else {
    elements.editTitle.textContent = 'New Profile';
  }
  
  setupEventListeners();
});

// Настройка обработчиков событий
function setupEventListeners() {
  elements.backBtn.addEventListener('click', goBack);
  elements.saveBtn.addEventListener('click', saveProfile);
  
  // Валидация в реальном времени
  elements.profileName.addEventListener('input', validateName);
  elements.host.addEventListener('input', validateHost);
  elements.port.addEventListener('input', validatePort);
}

// Загрузка профиля
async function loadProfile() {
  try {
    const state = await new Promise(resolve => {
      chrome.runtime.sendMessage(
        {type: "GET_PROXY_DATA"}, 
        resolve
      );
    });
    
    const profile = state.profiles.find(p => p.id === profileId);
    if (profile) {
      elements.profileName.value = profile.name || '';
      elements.host.value = profile.host || '';
      elements.port.value = profile.port || '';
      elements.username.value = profile.username || '';
      elements.password.value = profile.password || '';
      
      // Валидация загруженных данных
      validateName();
      validateHost();
      validatePort();
    }
  } catch (error) {
    console.error("Failed to load profile:", error);
  }
}

// Валидация имени
function validateName() {
  const isValid = elements.profileName.value.trim() !== '';
  toggleError(elements.profileName, elements.nameError, !isValid);
  return isValid;
}

// Валидация хоста
function validateHost() {
  const isValid = elements.host.value.trim() !== '';
  toggleError(elements.host, elements.hostError, !isValid);
  return isValid;
}

// Валидация порта
function validatePort() {
  const port = parseInt(elements.port.value);
  const isValid = !isNaN(port) && port > 0 && port <= 65535;
  toggleError(elements.port, elements.portError, !isValid);
  return isValid;
}

// Переключение состояния ошибки
function toggleError(input, errorElement, showError) {
  if (showError) {
    input.classList.add('error');
    errorElement.style.display = 'block';
  } else {
    input.classList.remove('error');
    errorElement.style.display = 'none';
  }
}

// Сохранение профиля
async function saveProfile() {
  const nameValid = validateName();
  const hostValid = validateHost();
  const portValid = validatePort();
  
  if (!nameValid || !hostValid || !portValid) {
    return;
  }
  
  const profile = {
    id: profileId,
    name: elements.profileName.value.trim(),
    host: elements.host.value.trim(),
    port: elements.port.value.trim(),
    username: elements.username.value.trim(),
    password: elements.password.value.trim()
  };
  
  try {
    setButtonState(elements.saveBtn, 'Saving...', true);
    
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage(
        {type: "SAVE_PROFILE", profile}, 
        resolve
      );
    });
    
    if (result.success) {
      // Анимация успешного сохранения
      elements.saveBtn.classList.add('success');
      setTimeout(() => goBack(), 300);
    } else if (result.error) {
      alert(result.error);
    }
  } catch (error) {
    console.error("Failed to save profile:", error);
    alert("Failed to save profile");
  } finally {
    setButtonState(elements.saveBtn, 'Save Profile', false);
  }
}

// Возврат на главный экран
function goBack() {
  document.body.style.opacity = '0';
  setTimeout(() => window.location.href = 'popup.html', 300);
}

// Управление состоянием кнопок
function setButtonState(button, text, isLoading) {
  button.textContent = text;
  
  if (isLoading) {
    button.classList.add('loading');
    button.disabled = true;
  } else {
    button.classList.remove('loading');
    button.disabled = false;
  }
}